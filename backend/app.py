from flask import Flask, request, jsonify
from flask_cors import CORS
import json

app = Flask(__name__)
CORS(app)  # allow frontend to call backend

# Load college data
with open("colleges.json") as f:
    colleges = json.load(f)

@app.route("/quiz", methods=["POST"])
def quiz():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400

    science = data.get("science")
    if science == "yes":
        return jsonify({"stream": "Science", "colleges": colleges["science"]})
    else:
        return jsonify({"stream": "Arts", "colleges": colleges["arts"]})

@app.route("/colleges", methods=["GET"])
def get_colleges():
    return jsonify(colleges)

if __name__ == "__main__":
    app.run(debug=True)
