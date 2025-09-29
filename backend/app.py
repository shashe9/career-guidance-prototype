# app.py
import os
import json
import logging
import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
import requests
import firebase_admin
from firebase_admin import credentials, auth, firestore
from firebase_admin import exceptions as fb_exceptions
from datetime import datetime



# ---------- Logging ----------
logging.basicConfig(stream=sys.stderr, level=logging.DEBUG)
logger = logging.getLogger("firebase-backend")

# ---------- Load environment ----------
load_dotenv()  # loads .env in backend/
FIREBASE_CRED = os.getenv("FIREBASE_CRED", "serviceAccountKey.json")  # relative path
FIREBASE_WEB_API_KEY = os.getenv("FIREBASE_WEB_API_KEY")  # required for signInWithPassword REST call

# ---------- Validate env ----------
if not os.path.exists(FIREBASE_CRED):
    logger.error("Firebase service account file not found at: %s", FIREBASE_CRED)
    # don't raise here so developer can see error in logs; we'll raise below
if not FIREBASE_WEB_API_KEY:
    logger.warning("FIREBASE_WEB_API_KEY not set in .env — login via password will fail until set.")

# ---------- Initialize Flask & CORS ----------
# ---------- Initialize Flask & CORS ----------
app = Flask(__name__)

# Read allowed origins from env (comma-separated). Default "*" for dev.
_allowed = os.getenv("ALLOWED_ORIGINS", "*")
if _allowed and _allowed != "*":
    origins = [o.strip() for o in _allowed.split(",") if o.strip()]
else:
    origins = "*"  # Careful: "*" allows ALL origins; tighten in production.

# allow credentials (cookies/Authorization) and explicit headers
CORS(app, origins=origins, supports_credentials=True)
app.config['CORS_HEADERS'] = 'Content-Type,Authorization'

# ---------- Initialize Firebase Admin ----------
try:
    cred = credentials.Certificate(FIREBASE_CRED)
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    logger.info("Firebase initialized using %s", FIREBASE_CRED)
except Exception as e:
    logger.exception("Failed to initialize Firebase Admin SDK. Check FIREBASE_CRED path and file.")
    # set db/auth to None so endpoints can handle gracefully
    db = None

# ---------- Allowed profile fields (from your schema) ----------
ALLOWED_PROFILE_FIELDS = {
    "full_name", "location", "date_of_birth", "gender", "class_grade",
    "previous_class_percentage", "stream", "favourite_subject", "hobby",
    "skills", "career_interest", "financial_condition", "parents_occupation",
    "language_preference", "extracurricular", "learning_style", "_saved_at"
}


# ---------- Helpers ----------
def make_profile_template(full_name=""):
    """Return a profile dict with all keys present (defaults None)."""
    return {
        "full_name": full_name,
        "location": None,
        "date_of_birth": None,
        "gender": None,
        "class_grade": None,
        "previous_class_percentage": None,
        "stream": None,
        "favourite_subject": None,
        "hobby": None,
        "skills": None,
        "career_interest": None,
        "financial_condition": None,
        "parents_occupation": None,
        "language_preference": None,
        "extracurricular": None,
        "learning_style": None,
    }

# --- near top of app.py (after imports and logger) ---
import pathlib

BASE_DIR = pathlib.Path(__file__).parent.resolve()

def load_json_file(name):
    path = BASE_DIR / name
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception as e:
            logger.exception("Failed to load JSON %s", path)
            return []
    return []

# Load reference catalogs (fall back to empty lists)
COLLEGES_DATA = load_json_file("colleges.json")
COURSES_DATA = load_json_file("courses.json")
CAREERS_DATA = load_json_file("careers.json")





def normalize_profile_fields(payload):
    """
    Keep only allowed fields and normalize certain values (e.g., skills string -> list).
    """
    out = {}
    for k, v in payload.items():
        if k not in ALLOWED_PROFILE_FIELDS:
            continue
        if k == "skills":
            # accept array or comma-separated string
            if isinstance(v, str):
                arr = [s.strip() for s in v.split(",") if s.strip()]
                out[k] = arr
            else:
                out[k] = v
        elif k == "previous_class_percentage":
            # convert to number if possible
            try:
                out[k] = float(v) if v is not None and v != "" else None
            except Exception:
                out[k] = v
        else:
            out[k] = v
    return out


def firebase_signin_with_password(email: str, password: str, api_key: str, timeout=8):
    """
    Calls Firebase REST API for "signInWithPassword".
    Returns (ok, result_dict)
    - ok True: result contains idToken, localId, refreshToken, etc.
    - ok False: result contains error message
    """
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
    payload = {"email": email, "password": password, "returnSecureToken": True}
    try:
        r = requests.post(url, json=payload, timeout=timeout)
        data = r.json()
        if r.status_code == 200:
            return True, data
        else:
            # Firebase returns {"error": {"message": "...", ...}}
            err = data.get("error", {}).get("message") if isinstance(data, dict) else "Unknown error"
            return False, {"error": err, "raw": data}
    except requests.RequestException as re:
        logger.exception("Network error when calling Firebase signInWithPassword")
        return False, {"error": "network_error", "detail": str(re)}


# ---------- ROUTES ----------
@app.route("/signup", methods=["POST"])
def signup():
    """
    Create Firebase Auth user + Firestore profile + auto-login for token.
    Request JSON: { email, password, full_name }
    """
    if db is None:
        return jsonify({"error": "Server misconfigured: Firestore not initialized"}), 500

    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")
    full_name = data.get("full_name") or ""

    if not email or not password:
        return jsonify({"error": "email and password are required"}), 400

    if len(password) < 6:
        return jsonify({"error": "password must be at least 6 characters"}), 400

    try:
        # Create user in Firebase Auth
        user = auth.create_user(email=email, password=password)
        uid = user.uid
        logger.info("Created Firebase user uid=%s email=%s", uid, email)

        # Create default profile in Firestore
        profile_data = make_profile_template(full_name=full_name)
        db.collection("profiles").document(uid).set(profile_data, merge=True)

        # Immediately sign in to get idToken
        access_token = None
        if FIREBASE_WEB_API_KEY:
            ok, login_res = firebase_signin_with_password(email, password, FIREBASE_WEB_API_KEY)
            if ok:
                access_token = login_res.get("idToken")

        res = {
            "message": "Signup successful",
            "user_id": uid,
            "access_token": access_token  # frontend expects this
        }
        return jsonify(res), 200

    except fb_exceptions.FirebaseError as fe:
        logger.exception("Firebase auth error during signup")
        return jsonify({"error": "firebase_error", "detail": str(fe)}), 400
    except Exception as e:
        logger.exception("Unexpected error in signup")
        return jsonify({"error": "server_error", "detail": str(e)}), 500


@app.route("/login", methods=["POST"])
def login():
    """
    Login via Firebase REST API.
    Request JSON: { email, password }
    Returns: { message, user_id, access_token, refresh_token, profile }
    """
    if db is None:
        return jsonify({"error": "Server misconfigured: Firestore not initialized"}), 500

    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password")

    if not email or not password:
        return jsonify({"error": "email and password required"}), 400

    if not FIREBASE_WEB_API_KEY:
        return jsonify({"error": "Server misconfigured: FIREBASE_WEB_API_KEY missing"}), 500

    ok, result = firebase_signin_with_password(email, password, FIREBASE_WEB_API_KEY)
    if not ok:
        err_msg = result.get("error") or "invalid_credentials"
        return jsonify({"error": err_msg, "raw": result.get("raw")}), 401

    user_id = result.get("localId")
    id_token = result.get("idToken")
    refresh_token = result.get("refreshToken")

    # fetch Firestore profile
    try:
        doc = db.collection("profiles").document(user_id).get()
        profile = doc.to_dict() if doc.exists else {}
    except Exception:
        profile = {}

    return jsonify({
        "message": "Login successful",
        "user_id": user_id,
        "access_token": id_token,   # 👈 frontend expects this
        "refresh_token": refresh_token,
        "profile": profile
    }), 200


@app.route("/profile", methods=["GET"])
def get_profile():
    """
    GET /profile?user_id=<uid>
    """
    if db is None:
        return jsonify({"error": "Server misconfigured: Firestore not initialized"}), 500

    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    try:
        doc = db.collection("profiles").document(user_id).get()
        if not doc.exists:
            return jsonify({"profile": {}}), 200
        return jsonify({"profile": doc.to_dict()}), 200
    except Exception as e:
        logger.exception("Error fetching profile for %s", user_id)
        return jsonify({"error": "server_error", "detail": str(e)}), 500


@app.route("/update-profile", methods=["POST"])
def update_profile():
    """
    POST /update-profile
    Request JSON must include user_id and allowed profile fields to update.
    """
    if db is None:
        return jsonify({"error": "Server misconfigured: Firestore not initialized"}), 500

    data = request.json or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    profile_updates = normalize_profile_fields(data)
    if not profile_updates:
        return jsonify({"error": "No valid profile fields provided"}), 400

    try:
        # Use set(merge=True) to merge fields (safe upsert)
        db.collection("profiles").document(user_id).set(profile_updates, merge=True)
        return jsonify({"message": "Profile updated successfully"}), 200
    except Exception as e:
        logger.exception("Error updating profile for %s", user_id)
        return jsonify({"error": "server_error", "detail": str(e)}), 500


@app.route("/login-test", methods=["GET"])
def login_test():
    """
    A handy test route to bypass auth and return a test user.
    It will create a 'test_user_local' Firestore profile if missing.
    Useful for prototyping the dashboard without real auth.
    """
    if db is None:
        return jsonify({"error": "Server misconfigured: Firestore not initialized"}), 500

    test_uid = "test_user_local"
    test_profile = {
        "full_name": "Test User",
        "location": "Test City",
        "date_of_birth": "2000-01-01",
        "gender": "Other",
        "class_grade": "12th",
        "previous_class_percentage": 88,
        "stream": "Science",
        "favourite_subject": "Maths",
        "hobby": "Coding",
        "skills": ["python", "electronics"],
        "career_interest": "AI",
        "financial_condition": "middle",
        "parents_occupation": "Engineer",
        "language_preference": "English",
        "extracurricular": "Robotics",
        "learning_style": "Visual",
    }
    try:
        doc_ref = db.collection("profiles").document(test_uid)
        doc = doc_ref.get()
        if not doc.exists:
            doc_ref.set(test_profile)
        return jsonify({
            "message": "Test login successful",
            "user_id": test_uid,
            "profile": test_profile
        }), 200
    except Exception as e:
        logger.exception("Error in login-test")
        return jsonify({"error": "server_error", "detail": str(e)}), 500
    



# ---------- Recommendation / Timeline generator helpers ----------
def find_matching_colleges(keywords, limit=3):
    """Simple fuzzy match: looks for programs or tags with keywords (case-insensitive)."""
    if not keywords:
        return []
    keywords = [k.lower() for k in (keywords if isinstance(keywords, (list, tuple)) else [keywords])]
    results = []
    for c in COLLEGES_DATA:
        score = 0
        # check tags
        tags = [t.lower() for t in c.get("tags", [])]
        for kw in keywords:
            if any(kw in t for t in tags):
                score += 2
        # check program names
        for p in c.get("programs_offered", []):
            pname = p.get("name","").lower()
            for kw in keywords:
                if kw in pname:
                    score += 3
        if score > 0:
            results.append((score, c))
    # sort and return top `limit`
    results.sort(key=lambda x: x[0], reverse=True)
    return [r[1] for r in results[:limit]]

def choose_course_suggestions(profile):
    """Very small rule-based suggestion for prototype."""
    stream = (profile.get("stream") or "").lower() if profile else ""
    fav = (profile.get("favourite_subject") or "").lower() if profile else ""
    interest = (profile.get("career_interest") or "").lower() if profile else ""
    skills = profile.get("skills") or []
    keywords = []

    # create keyword set
    for x in (interest, fav):
        if x: keywords.extend(x.split())

    # map stream -> suggested course(s)
    if "science" in stream or "pcb" in stream or "pcm" in stream:
        if "computer" in interest or "ai" in interest or "program" in " ".join(keywords):
            suggested = ["B.Tech in Computer Science & Engineering", "B.Sc in Computer Science", "B.Sc in Mathematics"]
            college_kw = ["computer", "engineering"]
        elif "biology" in fav or "biotech" in interest:
            suggested = ["B.Sc Biotechnology", "B.Sc Microbiology"]
            college_kw = ["biotechnology", "biology"]
        else:
            suggested = ["B.Tech in Engineering (choose branch)", "B.Sc (Science)"]
            college_kw = ["engineering", "science"]
    elif "commerce" in stream:
        suggested = ["B.Com", "BBA", "BMS"]
        college_kw = ["commerce", "management"]
    elif "arts" in stream or "humanities" in stream:
        suggested = ["BA (Humanities)", "B.Des (Design)"]
        college_kw = ["arts", "design"]
    else:
        # fallback: use interest keywords
        if "ai" in interest or "machine" in interest:
            suggested = ["B.Tech / B.Sc in Computer Science with AI electives"]
            college_kw = ["computer", "ai"]
        else:
            suggested = ["Explore foundation courses (UG diplomas or general B.Sc/BA)"]
            college_kw = ["university"]

    return {"suggested_courses": suggested, "college_keywords": college_kw}

def build_timeline_from_profile(profile, user_id=None):
    """
    Build a list of timeline nodes from user profile.
    Each node: { id, type, title, description, tips:[], resources:[], order:int }
    """
    nodes = []
    order = 1

    # 1. Immediate milestone
    grade = profile.get("class_grade") or "current studies"
    nodes.append({
        "id": f"m{order}",
        "type": "milestone",
        "title": f"Complete {grade}",
        "description": f"Focus on current studies and entrance exam prep (if applicable).",
        "tips": [
            "Maintain consistent study schedule",
            "Start entrance exam syllabus early if you target competitive exams"
        ],
        "order": order
    })
    order += 1

    # 2. Suggest course(s)
    course_info = choose_course_suggestions(profile)
    course_titles = course_info.get("suggested_courses", [])
    nodes.append({
        "id": f"m{order}",
        "type": "course",
        "title": f"Recommended course: {course_titles[0]}",
        "description": "Suggested course based on your stream, favorite subjects and interests.",
        "tips": [
            f"Consider {course_titles[0]} if you enjoy {profile.get('favourite_subject') or 'your chosen subjects'}",
            "Look at course curriculum and electives before applying"
        ],
        "suggested_courses": course_titles,
        "order": order
    })
    order += 1

    # 3. Find top colleges based on keywords
    college_candidates = find_matching_colleges(course_info.get("college_keywords", []) or [])
    college_nodes = []
    if college_candidates:
        top_names = []
        for c in college_candidates:
            top_names.append({"name": c.get("name"), "website": c.get("website")})
        nodes.append({
            "id": f"m{order}",
            "type": "college",
            "title": "Top suggested colleges",
            "description": "Colleges that match the suggested course or keywords.",
            "colleges": top_names,
            "order": order
        })
        order += 1

    # 4. Internships / Skills node
    skills = profile.get("skills") or []
    nodes.append({
        "id": f"m{order}",
        "type": "skills",
        "title": "Skills & Projects to build",
        "description": "Focus on practical projects and internships to build experience.",
        "tips": [
            "Do small projects and add to GitHub/portfolio",
            "Apply for internships or volunteer projects",
            f"Build skills: {', '.join(skills) if skills else 'communication, basic programming, problem-solving'}"
        ],
        "order": order
    })
    order += 1

    # 5. Career milestone
    nodes.append({
        "id": f"m{order}",
        "type": "career",
        "title": f"Entry-level career: {profile.get('career_interest') or 'Relevant industry roles'}",
        "description": "Target entry-level roles and internships; plan certifications if needed.",
        "tips": [
            "Network with alumni and industry professionals",
            "Prepare resume and practice interviews"
        ],
        "order": order
    })
    order += 1

    # 6. Summary node
    nodes.append({
        "id": f"m{order}",
        "type": "summary",
        "title": "Summary & Next Steps",
        "description": "A compact action plan created for you. Follow the order of milestones.",
        "tips": [
            "Save this roadmap and revisit every 6 months",
            "Update your profile after completing milestones to refresh recommendations"
        ],
        "order": order
    })

    # attach meta
    timeline = {
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "by_version": "rule-v1",
        "nodes": nodes
    }
    return timeline



@app.route("/generate-timeline", methods=["POST"])
def generate_timeline():
    """
    POST /generate-timeline
    Body JSON: { user_id: <uid>, force: <bool> }  (force = regenerate)
    Returns: { message, career_timeline }
    """
    if db is None:
        return jsonify({"error": "Server misconfigured: Firestore not initialized"}), 500

    data = request.json or {}
    user_id = data.get("user_id")
    force = bool(data.get("force", False))

    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    try:
        doc_ref = db.collection("profiles").document(user_id)
        doc = doc_ref.get()
        profile = doc.to_dict() if doc.exists else {}

        # If timeline exists and not forced -> return existing
        existing = profile.get("career_timeline")
        if existing and not force:
            return jsonify({"message": "existing", "career_timeline": existing}), 200

        # Build timeline
        timeline = build_timeline_from_profile(profile or {}, user_id=user_id)

        # Save into Firestore under 'career_timeline'
        doc_ref.set({"career_timeline": timeline}, merge=True)
        return jsonify({"message": "generated", "career_timeline": timeline}), 200

    except Exception as e:
        logger.exception("Error generating timeline for %s", user_id)
        return jsonify({"error": "server_error", "detail": str(e)}), 500




# ---------- Run ----------
if __name__ == "__main__":
    logger.info("Starting Flask (Firebase) backend on http://127.0.0.1:5000")
    app.run(debug=True, host="127.0.0.1", port=5000)
