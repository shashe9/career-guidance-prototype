/**
 * script.js — Firebase-backed prototype (frontend -> Flask backend)
 *
 * Expected backend endpoints:
 *  - POST /signup           { email, password, full_name } -> { message, user_id, access_token? }
 *  - POST /login            { email, password } -> { message, user_id, access_token, profile? }
 *  - GET  /profile?user_id= -> { profile: {...} }
 *  - POST /update-profile   { user_id, ...profileFields } -> { message }
 *  - GET  /login-test       -> { user_id, profile }   (optional dev bypass)
 *
 * Notes:
 *  - This is a prototype: tokens are stored in localStorage for convenience.
 *  - Do NOT keep this in production.
 */

document.addEventListener("DOMContentLoaded", () => {
  /* ---------------------------
     Config
     --------------------------- */
  const API_BASE = "http://127.0.0.1:5000"; // backend base URL

  /* ---------------------------
     Session helpers (prototype)
     --------------------------- */
  const LS_USER_ID = "cg_user_id";
  const LS_TOKEN = "cg_access_token";
  const setSession = (userId, accessToken) => {
    if (userId) localStorage.setItem(LS_USER_ID, userId);
    if (accessToken) localStorage.setItem(LS_TOKEN, accessToken);
  };
  const clearSession = () => {
    localStorage.removeItem(LS_USER_ID);
    localStorage.removeItem(LS_TOKEN);
  };
  const getUserId = () => localStorage.getItem(LS_USER_ID) || "";
  const getToken = () => localStorage.getItem(LS_TOKEN) || "";

  /* ---------------------------
     DOM references
     --------------------------- */
  const openSignupBtn = document.getElementById("open-signup");
  const signupModal = document.getElementById("signup-modal");
  const signupForm = document.getElementById("signup-form");
  const signupStatusEl = document.getElementById("signup-status");

  const careerOverlay = document.getElementById("career-setup-overlay");
  const careerForm = document.getElementById("career-setup-form");
  const stepEls = careerForm ? Array.from(careerForm.querySelectorAll(".wizard-step")) : [];
  const prevBtn = document.getElementById("ws-prev");
  const nextBtn = document.getElementById("ws-next");
  const submitBtn = document.getElementById("ws-submit");
  const progressBar = document.getElementById("progress-bar");

  const loginForm = document.getElementById("login-form");
  const loginStatus = document.getElementById("login-status");

  // Optional dev button: add <button id="test-login">Test login</button> to your HTML to use
  const testLoginBtn = document.getElementById("test-login");

  /* ---------------------------
     Guards
     --------------------------- */
  if (!signupModal || !signupForm || !careerOverlay || !careerForm) {
    console.warn("script.js: some expected elements are missing. Check your HTML IDs.");
  }

  /* ---------------------------
     Utilities
     --------------------------- */
  function safeJSON(resp) {
    // try to parse JSON, otherwise return null
    return resp.text()
      .then(txt => {
        try { return txt ? JSON.parse(txt) : {}; }
        catch (e) { return null; }
      });
  }

  function showStatus(el, msg, ms = 2500) {
    if (!el) return;
    el.textContent = msg;
    if (ms > 0) setTimeout(() => { try { el.textContent = ""; } catch {} }, ms);
  }

  function getAuthHeaders() {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  /* ---------------------------
     Modal / focus-trap helpers
     --------------------------- */
  let lastFocusedBeforeOpen = null;
  let removeFocusTrap = null;

  function getFocusable(node) {
    if (!node) return [];
    const selector = 'a[href], area[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(node.querySelectorAll(selector)).filter(el => el.offsetParent !== null);
  }

  function trapFocus(container) {
    const focusable = getFocusable(container);
    if (focusable.length === 0) return () => {};
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    function keyHandler(e) {
      if (e.key === "Tab") {
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else if (e.key === "Escape") {
        // global ESC handling below
      }
    }
    document.addEventListener("keydown", keyHandler);
    return () => document.removeEventListener("keydown", keyHandler);
  }

  function openModal(modalEl, triggerEl = null) {
    if (!modalEl) return;
    lastFocusedBeforeOpen = triggerEl || document.activeElement;
    modalEl.classList.remove("hidden");
    modalEl.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    removeFocusTrap = trapFocus(modalEl);
    const focusables = getFocusable(modalEl);
    if (focusables.length) focusables[0].focus();
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    modalEl.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    if (typeof removeFocusTrap === "function") { removeFocusTrap(); removeFocusTrap = null; }
    if (lastFocusedBeforeOpen && lastFocusedBeforeOpen.focus) {
      try { lastFocusedBeforeOpen.focus(); } catch (e) {}
      lastFocusedBeforeOpen = null;
    }
  }

  /* ---------------------------
     Signup flow (calls backend /signup)
     --------------------------- */
  if (openSignupBtn && signupModal) {
    openSignupBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openModal(signupModal, openSignupBtn);
    });
  }

  if (signupModal) {
    signupModal.addEventListener("click", (ev) => {
      if (ev.target === signupModal) closeModal(signupModal);
      const action = ev.target.dataset && ev.target.dataset.action;
      if (action === "close-signup" || action === "cancel-signup") {
        closeModal(signupModal);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (signupStatusEl) signupStatusEl.textContent = "";

      const full_name = (signupForm.querySelector("input[name='full_name']") || {}).value || "";
      const email = ((signupForm.querySelector("input[name='email']") || {}).value || "").trim().toLowerCase();
      const password = (signupForm.querySelector("input[name='password']") || {}).value || "";
      const password2 = (signupForm.querySelector("input[name='password2']") || {}).value || "";

      if (!full_name || !email || !password) {
        showStatus(signupStatusEl, "Please fill name, email and password.");
        return;
      }
      if (password !== password2) {
        showStatus(signupStatusEl, "Passwords do not match.");
        return;
      }

      try {
        showStatus(signupStatusEl, "Signing up...");
        const resp = await fetch(`${API_BASE}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_name, email, password })
        });

        const j = await safeJSON(resp);
        if (!resp.ok) {
          const err = (j && (j.error || j.message)) || `Signup failed (${resp.status})`;
          showStatus(signupStatusEl, err);
          return;
        }

        // success: backend should return user_id and maybe access_token
        const userId = (j && (j.user_id || j.user?.id)) || "";
        const accessToken = (j && (j.access_token || j.token || j.id_token)) || "";

        if (!userId) {
          showStatus(signupStatusEl, "Signup succeeded but no user_id returned from server.");
          return;
        }

        // save session (prototype)
        setSession(userId, accessToken);

        // close and open wizard, prefill name
        closeModal(signupModal);
        openWizardOverlay();
        const wsFull = careerForm.querySelector("#ws-full_name");
        if (wsFull) wsFull.value = full_name;

      } catch (err) {
        console.error("Signup error", err);
        showStatus(signupStatusEl, "Network or server error during signup.");
      }
    });
  }

  /* ---------------------------
     Wizard overlay (open/close/navigation)
     --------------------------- */
  function openWizardOverlay() {
    if (!careerOverlay) return;
    openModal(careerOverlay, document.getElementById("open-signup") || null);
    currentStepIndex = 0;
    updateWizardUI();
  }
  function closeWizardOverlay() {
    if (!careerOverlay) return;
    closeModal(careerOverlay);
  }
  if (careerOverlay) {
    careerOverlay.addEventListener("click", (ev) => {
      if (ev.target === careerOverlay) closeWizardOverlay();
      const action = ev.target.dataset && ev.target.dataset.action;
      if (action === "close-wizard") closeWizardOverlay();
    });
  }

  let currentStepIndex = 0;
  function updateWizardUI() {
    if (!stepEls || stepEls.length === 0) return;
    stepEls.forEach((el, i) => {
      const active = i === currentStepIndex;
      el.classList.toggle("active", active);
      el.setAttribute("aria-hidden", active ? "false" : "true");
    });
    if (prevBtn) prevBtn.disabled = currentStepIndex === 0;
    if (nextBtn) nextBtn.style.display = currentStepIndex === stepEls.length - 1 ? "none" : "inline-block";
    if (submitBtn) submitBtn.style.display = currentStepIndex === stepEls.length - 1 ? "inline-block" : "none";
    if (progressBar) {
      const pct = Math.round(((currentStepIndex + 1) / Math.max(1, stepEls.length)) * 100);
      progressBar.style.width = pct + "%";
      progressBar.setAttribute("aria-valuenow", String(pct));
    }
  }
  if (nextBtn) nextBtn.addEventListener("click", () => {
    if (currentStepIndex < stepEls.length - 1) {
      currentStepIndex++;
      updateWizardUI();
      const f = stepEls[currentStepIndex].querySelector("input, select, textarea, button");
      if (f) f.focus();
    }
  });
  if (prevBtn) prevBtn.addEventListener("click", () => {
    if (currentStepIndex > 0) {
      currentStepIndex--;
      updateWizardUI();
      const f = stepEls[currentStepIndex].querySelector("input, select, textarea, button");
      if (f) f.focus();
    }
  });

  /* ---------------------------
     Helper: serialize form to JSON (handles checkboxes/radios/multiple)
     --------------------------- */
  function formToJson(formEl) {
    const out = {};
    if (!formEl) return out;

    // Gather by input name
    const elements = Array.from(formEl.elements).filter(Boolean);
    const byName = {};
    elements.forEach(el => {
      if (!el.name) return;
      if (!byName[el.name]) byName[el.name] = [];
      byName[el.name].push(el);
    });

    for (const name in byName) {
      const group = byName[name];

      // If it's a set of checkboxes -> collect checked values array
      if (group.every(el => el.type === "checkbox")) {
        const vals = group.filter(el => el.checked).map(el => el.value);
        out[name] = vals;
        continue;
      }

      // If it's radios -> pick checked one
      if (group.every(el => el.type === "radio")) {
        const checked = group.find(el => el.checked);
        out[name] = checked ? checked.value : null;
        continue;
      }

      // If single select multiple
      if (group.length === 1) {
        const el = group[0];
        if (el.tagName.toLowerCase() === "select" && el.multiple) {
          out[name] = Array.from(el.selectedOptions).map(o => o.value);
        } else if (el.type === "number") {
          out[name] = el.value ? Number(el.value) : null;
        } else {
          // normalize "skills" if it's comma separated text field
          if (name === "skills" && typeof el.value === "string") {
            const arr = el.value.split(",").map(s => s.trim()).filter(Boolean);
            out[name] = arr;
          } else {
            out[name] = el.value;
          }
        }
        continue;
      }

      // fallback: multiple inputs with same name but not checkbox/radio -> array
      out[name] = group.map(el => el.value);
    }

    return out;
  }

  /* ---------------------------
     Submit wizard: POST /update-profile
     --------------------------- */
  if (careerForm) {
    careerForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      const profile = formToJson(careerForm);
      profile._saved_at = new Date().toISOString();

      const userId = getUserId();
      if (!userId) {
        alert("You must be logged in to save your profile. Please sign up / login.");
        return;
      }
      profile.user_id = userId;

      try {
        const headers = getAuthHeaders();
        const resp = await fetch(`${API_BASE}/update-profile`, {
          method: "POST",
          headers,
          body: JSON.stringify(profile)
        });

        const j = await safeJSON(resp);
        if (!resp.ok) {
          const err = (j && (j.error || j.message)) || `Profile save failed (${resp.status})`;
          alert("Error saving profile: " + err);
          return;
        }

        // success -> navigate or close
        try {
          // Hide landing + signup
            document.getElementById("landing-container").classList.add("hidden");
            document.getElementById("signup-modal").classList.add("hidden");

            // Show dashboard
            document.getElementById("db-shell").classList.remove("hidden");

            // Save session so refresh keeps user in dashboard
            saveSession(userData); // whatever you’re calling the session save

        } catch (e) {
          closeWizardOverlay();
          alert("Profile saved. Redirect to dashboard failed; wizard closed.");
        }
      } catch (err) {
        console.error("update-profile error", err);
        alert("Network or server error while saving profile.");
      }
    });
  }

  /* ---------------------------
     Login: POST /login and optionally fetch profile
     --------------------------- */
  if (loginForm) {
    loginForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (loginStatus) loginStatus.textContent = "";

      const email = (loginForm.querySelector("input[name='email']") || {}).value || "";
      const password = (loginForm.querySelector("input[name='password']") || {}).value || "";

      if (!email || !password) {
        showStatus(loginStatus, "Please enter email & password.");
        return;
      }

      try {
        showStatus(loginStatus, "Logging in...");
        const resp = await fetch(`${API_BASE}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });

        const j = await safeJSON(resp);
        if (!resp.ok) {
          const err = (j && (j.error || j.message)) || `Login failed (${resp.status})`;
          showStatus(loginStatus, err);
          return;
        }

        const userId = (j && (j.user_id || j.user?.id)) || "";
        const accessToken = (j && (j.access_token || j.token || j.id_token)) || "";

        if (!userId) {
          showStatus(loginStatus, "Login succeeded but no user_id returned.");
          return;
        }

        // Save session token & id
        setSession(userId, accessToken);

        // fetch profile to see if user has completed wizard
        const headers = {};
        if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
        const profResp = await fetch(`${API_BASE}/profile?user_id=${encodeURIComponent(userId)}`, { headers });

        if (profResp.ok) {
          const profJson = await safeJSON(profResp);
          if (profJson && profJson.profile && Object.keys(profJson.profile).length > 0) {
            // profile exists -> redirect to dashboard
            document.getElementById("landing-container").classList.add("hidden");
            document.getElementById("signup-modal").classList.add("hidden");

            // Show dashboard
            document.getElementById("db-shell").classList.remove("hidden");

            // Save session so refresh keeps user in dashboard
            saveSession(userData); // whatever you’re calling the session save
            return;
          }
        }

        // else open wizard to collect profile
        openWizardOverlay();
        const wsFull = careerForm.querySelector("#ws-full_name");
        if (wsFull && (j.full_name || (typeof profResp !== "undefined" && profResp.full_name))) {
          wsFull.value = j.full_name || (profResp && profResp.full_name) || "";
        }
      } catch (err) {
        console.error("Login error", err);
        showStatus(loginStatus, "Network or server error during login.");
      }
    });
  }

  /* ---------------------------
     Optional dev: login-test (bypass) button handling
     --------------------------- */
  if (testLoginBtn) {
    testLoginBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      try {
        const resp = await fetch(`${API_BASE}/login-test`);
        const j = await safeJSON(resp);
        if (!resp.ok) {
          alert("Test login failed: " + ((j && (j.error || j.message)) || resp.status));
          return;
        }
        const userId = j.user_id;
        const profile = j.profile || {};
        // store session (no real token)
        setSession(userId, "test-token");
        // store profile optionally in localStorage if you want
        localStorage.setItem("cg_profile", JSON.stringify(profile));
        // go to dashboard
        document.getElementById("landing-container").classList.add("hidden");
        document.getElementById("signup-modal").classList.add("hidden");

        // Show dashboard
        document.getElementById("db-shell").classList.remove("hidden");

        // Save session so refresh keeps user in dashboard
        saveSession(userData); // whatever you’re calling the session save
      } catch (err) {
        console.error("Test login error", err);
        alert("Network error during test login.");
      }
    });
  }

  /* ---------------------------
     Global keyboard handling (ESC closes overlays)
     --------------------------- */
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (signupModal && !signupModal.classList.contains("hidden")) closeModal(signupModal);
      if (careerOverlay && !careerOverlay.classList.contains("hidden")) closeWizardOverlay();
    }
  });

  /* ---------------------------
     Expose helpful dev functions
     --------------------------- */
  window._cg_session = {
    getUserId, getToken, setSession, clearSession
  };

});

















//-----------------------------------------
//dashboard utilities
//=========================================



document.addEventListener("DOMContentLoaded", () => {
  const session = getSession(); // your own function that checks localStorage/cookies

  if (session) {
    // Already logged in
    document.getElementById("landing-container").classList.add("hidden");
    document.getElementById("signup-modal").classList.add("hidden");
    document.getElementById("db-shell").classList.remove("hidden");

    // (optional) update profile info in dashboard
    document.getElementById("db-profile-name").textContent = session.full_name;
    document.getElementById("db-user-firstname").textContent = session.full_name.split(" ")[0];
  } else {
    // Not logged in → show landing
    document.getElementById("landing-container").classList.remove("hidden");
    document.getElementById("db-shell").classList.add("hidden");
  }
});


function logout() {
  localStorage.removeItem("session");
  document.getElementById("db-shell").classList.add("hidden");
  document.getElementById("landing-container").classList.remove("hidden");
}






//Quiz===========================================================================
//===============================================================================

// Open quiz modal when user clicks the quiz card button
document.getElementById("db-card-quiz").addEventListener("click", () => {
  document.getElementById("career-quiz-modal").classList.remove("hidden");
  currentQuestion = 0;  // reset quiz if reopened
  answers = {};
  loadQuestion(currentQuestion);
});

// Optional: close modal when clicking outside
document.addEventListener("click", (e) => {
  const modal = document.getElementById("career-quiz-modal");
  if (!modal.classList.contains("hidden") && e.target === modal) {
    modal.classList.add("hidden");
  }
});


const quizData = [
  {
    id: "q1",
    question: "Which subject excites you the most?",
    options: ["Physics", "Biology", "Mathematics", "Arts", "Commerce", "Computer Science"]
  },
  {
    id: "q2",
    question: "Which type of work appeals to you?",
    options: ["Helping People", "Building Technology", "Doing Research", "Creative Arts", "Business/Commerce"]
  },
  {
    id: "q3",
    question: "Rate your Analytical Skills (1-5)",
    options: ["1", "2", "3", "4", "5"]
  },
  {
    id: "q4",
    question: "What is more important for you?",
    options: ["High Salary Early", "Job Security", "Long-Term Growth", "Work-Life Balance"]
  },
  {
    id: "q5",
    question: "Do you want to study outside Jammu & Kashmir?",
    options: ["Yes", "No"]
  }
];

let currentQuestion = 0;
const answers = {};

const quizContainer = document.getElementById("quiz-container");
const nextBtn = document.getElementById("quiz-next-btn");
const submitBtn = document.getElementById("quiz-submit-btn");

function loadQuestion(index) {
  const q = quizData[index];
  quizContainer.innerHTML = `
    <h3>${q.question}</h3>
    ${q.options.map(opt => `
      <label>
        <input type="radio" name="${q.id}" value="${opt}" required> ${opt}
      </label><br>
    `).join("")}
  `;
}

nextBtn.addEventListener("click", () => {
  const selected = document.querySelector(`input[name="${quizData[currentQuestion].id}"]:checked`);
  if (!selected) return alert("Please select an option");
  answers[quizData[currentQuestion].id] = selected.value;
  
  currentQuestion++;
  if (currentQuestion < quizData.length) {
    loadQuestion(currentQuestion);
  } else {
    nextBtn.classList.add("hidden");
    submitBtn.classList.remove("hidden");
  }
});

submitBtn.addEventListener("click", () => {
  // 🔹 Save to Firestore (example)
  const userId = localStorage.getItem("userId");
  // db.collection("users").doc(userId).collection("quizResults").doc("careerAptitude").set(answers);

  console.log("Quiz submitted:", answers);
  alert("Quiz submitted successfully!");

  document.getElementById("career-quiz-modal").classList.add("hidden");
});

// Load first question
loadQuestion(currentQuestion);
