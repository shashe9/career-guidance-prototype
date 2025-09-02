/* script.js
   Controls the multi-step quiz, tag-scoring, UI interactions, and integration with the Flask backend.
   Assumes backend endpoints:
     POST   /quiz      -> returns { stream, colleges, scholarships, roadmap, ... }
     GET    /colleges  -> returns list of colleges (for map preview)
   Change BACKEND_URL below when deploying.
*/

const BACKEND_URL = (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")
  ? "http://127.0.0.1:5000"
  : "https://your-backend.onrender.com"; // update when deployed

document.addEventListener("DOMContentLoaded", () => {
  /* -------------------------
     Element references
     ------------------------- */
  const landingQuiz = document.getElementById("landing-quiz");
  const startBtn = document.getElementById("startQuiz");
  const ctaStartQuiz = document.getElementById("ctaStartQuiz");
  const ctaBrowseColleges = document.getElementById("ctaBrowseColleges");

  const takeQuizWidget = document.getElementById("takeQuizWidget");
  const quizMulti = document.getElementById("quizMulti");
  const quizSteps = Array.from(document.querySelectorAll(".quiz-step"));
  const totalStepsEl = document.getElementById("totalSteps");
  const currentStepEl = document.getElementById("currentStep");
  const quizProgressFill = document.getElementById("quizProgressFill");
  const quizReview = document.getElementById("quizReview");

  const quizStepForms = {
    1: document.getElementById("quizStep1"),
    2: document.getElementById("quizStep2"),
    3: document.getElementById("quizStep3"),
    4: document.getElementById("quizStep4")
  };

  const assistantCard = document.getElementById("assistantCard");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatLog = document.getElementById("chatLog");

  const recList = document.getElementById("recList");
  const snapshotName = document.getElementById("snapshotName");
  const snapshotEducation = document.getElementById("snapshotEducation");
  const snapshotIncome = document.getElementById("snapshotIncome");
  const snapshotMode = document.getElementById("snapshotMode");

  const mapListPreview = document.querySelector("#mapListPreview ul");
  const nearbyCount = document.getElementById("nearbyCount");
  const scholarshipCount = document.getElementById("scholarshipCount");
  const savedList = document.getElementById("savedList");

  const navLinks = Array.from(document.querySelectorAll(".nav-link"));

  let currentStep = 1;
  const totalSteps = quizSteps.length || 4;
  totalStepsEl && (totalStepsEl.innerText = totalSteps);

  // online/offline mode
  let onlineMode = JSON.parse(localStorage.getItem("cg_online_mode") || "true");

  /* -------------------------
     Utility helpers
     ------------------------- */
  function show(el) { if (el) el.style.display = ""; }
  function hide(el) { if (el) el.style.display = "none"; }
  function setAriaHidden(el, hidden) {
  if (el) {
    el.setAttribute("aria-hidden", hidden);
  }
}

  function setActiveNav(view) {
    navLinks.forEach(link => {
      const v = link.getAttribute("data-view");
      if (v === view) link.classList.add("active");
      else link.classList.remove("active");
    });
  }

  function showView(view) {
    // basic mapping of views to actions
    setActiveNav(view);
    // dashboard view
    if (view === "dashboard") {
      document.getElementById("dashboard").scrollIntoView({ behavior: "smooth" });
      hide(takeQuizWidget);
      // show other default things (assistant visible)
      show(assistantCard);
    }
    if (view === "take-quiz") {
      // show quiz widget and go to step 1
      show(takeQuizWidget);
      goToStep(1);
      // optionally scroll into view
      takeQuizWidget.scrollIntoView({ behavior: "smooth" });
    }
    if (view === "colleges") {
      // reveal map card
      const mapCard = document.getElementById("mapCard");
      mapCard && mapCard.scrollIntoView({ behavior: "smooth" });
    }
    // other views can be wired similarly
  }

  /* -------------------------
     Multi-step quiz logic
     ------------------------- */
  function goToStep(step) {
    if (step < 1) step = 1;
    if (step > totalSteps) step = totalSteps;
    currentStep = step;

    // hide all steps and show current
    quizSteps.forEach(s => hide(s));
    const el = document.querySelector(`.quiz-step[data-step="${step}"]`);
    show(el);

    // update UI progress
    currentStepEl && (currentStepEl.innerText = step);
    const percent = Math.round(((step - 1) / (totalSteps - 1)) * 100);
    if (quizProgressFill) quizProgressFill.style.width = `${percent}%`;
  }

  function collectTagScores() {
    // For step 2 question-cards: find selected inputs and build tagScores with weights
    const tagScores = {}; // { tag: numericScore }
    const qCards = Array.from(document.querySelectorAll(".question-card"));
    qCards.forEach(card => {
      // find checked input inside the card
      const checked = card.querySelector("input[type='radio']:checked");
      if (!checked) return;
      const tagsAttr = checked.getAttribute("data-tags") || "";
      const tags = tagsAttr.split(",").map(t => t.trim()).filter(Boolean);
      const val = checked.value || "";
      // map value to weight (customize mapping as needed)
      let weight = 0;
      const v = val.toLowerCase();
      if (v === "always" || v === "always") weight = 2;
      else if (v === "sometimes" || v === "sometimes") weight = 1;
      else if (v === "rarely" || v === "rarely" || v === "never") weight = 0;
      else {
        // if numeric values present (e.g., 0..5), try parse
        const n = parseFloat(val);
        if (!isNaN(n)) weight = n;
        else weight = 1;
      }
      tags.forEach(tag => {
        tagScores[tag] = (tagScores[tag] || 0) + weight;
      });
    });
    return tagScores;
  }

  function collectAllQuizData() {
    const data = {};
    // Step 1 fields
    const step1 = quizStepForms[1];
    if (step1) {
      const s1 = Object.fromEntries(new FormData(step1).entries());
      Object.assign(data, s1);
    }
    // Step 3 (constraints)
    const step3 = quizStepForms[3];
    if (step3) {
      const s3 = Object.fromEntries(new FormData(step3).entries());
      Object.assign(data, s3);
    }
    // Step 2: interests & tagged answers
    const answers = {};
    const qCards = Array.from(document.querySelectorAll(".question-card"));
    qCards.forEach(card => {
      const qid = card.getAttribute("data-qid") || card.querySelector("[name]")?.name || null;
      const checked = card.querySelector("input[type='radio']:checked");
      if (qid && checked) {
        answers[qid] = checked.value;
      }
    });
    data.answers = answers;
    // tag scores
    data.tagScores = collectTagScores();

    return data;
  }

  function renderReview(data) {
    // Build a human-readable review summary
    const lines = [];
    if (data.name) lines.push(`<strong>Name:</strong> ${escapeHtml(data.name)}`);
    if (data.education) lines.push(`<strong>Education:</strong> ${escapeHtml(data.education)}`);
    if (data.location) lines.push(`<strong>Location:</strong> ${escapeHtml(data.location)}`);
    if (data.budget) lines.push(`<strong>Budget (monthly):</strong> ₹${escapeHtml(data.budget)}`);
    // tag summary
    if (data.tagScores) {
      const tags = Object.entries(data.tagScores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([t, s]) => `${escapeHtml(t)} (${s})`);
      if (tags.length) lines.push(`<strong>Top skills/tags:</strong> ${tags.join(", ")}`);
    }
    quizReview.innerHTML = lines.length ? `<div>${lines.join("<br>")}</div>` : `<div>No answers yet.</div>`;
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function submitQuizData(payload) {
    // show loading in assistant panel or recommendation area
    appendChatMessage("ai", "Working on your personalized plan...");

    try {
      const res = await fetch(`${BACKEND_URL}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Backend error: ${res.status} ${text}`);
      }
      const result = await res.json();
      appendChatMessage("ai", "Got results. Rendering recommendations.");
      renderRecommendations(result, payload);
      saveQuizLocal(payload, result);
      return result;
    } catch (err) {
      console.error("submitQuizData error:", err);
      appendChatMessage("ai", "Could not reach the server. You're probably offline or backend not running.");
      // show some fallback if available
      renderOfflineFallback(payload);
      return null;
    }
  }

  function renderRecommendations(result, payload = {}) {
    // Update snapshot
    snapshotName && (snapshotName.textContent = payload.name || "Guest User");
    snapshotEducation && (snapshotEducation.textContent = payload.education || "—");
    snapshotIncome && (snapshotIncome.textContent = payload.income ? `₹${payload.income}` : "—");
    snapshotMode && (snapshotMode.textContent = payload.medium || payload.learning || "—");

    // render quick rec list
    recList.innerHTML = "";
    if (!result) {
      recList.innerHTML = "<li class='rec-item'>No recommendations available.</li>";
      return;
    }

    // Primary stream
    const primary = result.stream || "Not determined";
    // Add top summary item
    const mainItem = document.createElement("li");
    mainItem.className = "rec-item";
    mainItem.innerHTML = `
      <div class="rec-left">
        <div class="rec-title">Suggested Stream: ${escapeHtml(primary)}</div>
        <div class="rec-meta">${escapeHtml(result.reason || "Based on your quiz responses")}</div>
      </div>
      <div class="rec-actions">
        <button class="btn tiny" data-action="view-roadmap">View Roadmap</button>
        <button class="btn tiny outline" data-action="save-rec">Save</button>
      </div>
    `;
    recList.appendChild(mainItem);

    // Colleges
    if (Array.isArray(result.colleges)) {
      result.colleges.slice(0, 6).forEach(col => {
        const li = document.createElement("li");
        li.className = "rec-item";
        const name = typeof col === "string" ? col : (col.name || "Unknown College");
        const meta = typeof col === "object"
          ? `Medium: ${col.medium || "—"} • Hostel: ${col.hostel ? "Yes" : "No"} • ${col.distance_km ? `${col.distance_km} km` : ""} • Fees: ₹${col.fees || "—"}`
          : "";
        li.innerHTML = `
          <div class="rec-left">
            <div class="rec-title">${escapeHtml(name)}</div>
            <div class="rec-meta">${escapeHtml(meta)}</div>
          </div>
          <div class="rec-actions">
            <button class="btn tiny" data-action="view-college" data-college='${JSON.stringify(col)}'>Details</button>
            <button class="btn tiny outline" data-action="save-college" data-college-name="${escapeHtml(name)}">Save</button>
          </div>
        `;
        recList.appendChild(li);
      });
    }

    // Scholarships
    if (Array.isArray(result.scholarships)) {
      scholarshipCount && (scholarshipCount.textContent = result.scholarships.length);
    }

    // Update map preview list
    if (Array.isArray(result.colleges)) {
      mapListPreview.innerHTML = "";
      result.colleges.slice(0, 5).forEach(col => {
        const name = typeof col === "string" ? col : (col.name || "Unknown College");
        const li = document.createElement("li");
        li.textContent = `${name} — ${col.streams ? col.streams.join(", ") : ""} — ${col.distance_km ? `${col.distance_km} km` : ""}`;
        mapListPreview.appendChild(li);
      });
      nearbyCount && (nearbyCount.textContent = result.colleges.length);
    }

    // Roadmap / details panel
    const roadmapEl = document.getElementById("roadmapResult");
    if (roadmapEl) {
      roadmapEl.innerHTML = result.roadmap
        ? `<div><strong>Roadmap:</strong><div>${escapeHtml(result.roadmap)}</div></div>`
        : "<div><strong>Roadmap:</strong> Basic guidance provided.</div>";
    }

    // Scholarships panel
    const scholarshipEl = document.getElementById("scholarshipResult");
    scholarshipEl && (scholarshipEl.innerHTML = result.scholarships && result.scholarships.length
      ? `<div><strong>Scholarships:</strong><ul>${result.scholarships.map(s => `<li>${escapeHtml(s.title || s)}</li>`).join("")}</ul></div>`
      : "<div><strong>Scholarships:</strong> None found</div>");
  }

  function renderOfflineFallback(payload) {
    // Create a minimal local recommendation based on tagScores top tag heuristic
    let fallbackStream = "General Arts/Commerce";
    if (payload.tagScores) {
      const tags = Object.entries(payload.tagScores).sort((a, b) => b[1] - a[1]);
      if (tags.length) {
        const top = tags[0][0];
        if (top.includes("lab") || top.includes("practical") || top.includes("analytical") || top.includes("maths")) fallbackStream = "Science";
        else if (top.includes("communication") || top.includes("arts")) fallbackStream = "Arts";
        else if (top.includes("business") || top.includes("commerce")) fallbackStream = "Commerce";
      }
    }
    const mock = {
      stream: fallbackStream,
      colleges: [
        { name: "Local Govt College 1", medium: "Hindi", hostel: true, distance_km: 6, fees: 1500 },
        { name: "Local Govt College 2", medium: "English", hostel: false, distance_km: 18, fees: 1200 }
      ],
      scholarships: [],
      reason: "Fallback recommendation (offline mode)"
    };
    renderRecommendations(mock, payload);
  }

  function saveQuizLocal(payload, result) {
    const saved = { timestamp: Date.now(), payload, result };
    localStorage.setItem("cg_last_quiz", JSON.stringify(saved));
    // also add saved quiz to saved items list for quick access
    const entry = document.createElement("li");
    entry.className = "saved-item";
    entry.textContent = `${payload.name || "Guest"} — ${new Date(saved.timestamp).toLocaleString()}`;
    savedList && savedList.prepend(entry);
  }

  /* -------------------------
     Event delegation for quiz navigation buttons
     ------------------------- */
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-action");

    if (action === "next-step") {
      goToStep(Math.min(currentStep + 1, totalSteps));
      // if moving to review step (last), update review summary
      if (currentStep === totalSteps) {
        const data = collectAllQuizData();
        renderReview(data);
      }
    } else if (action === "prev-step") {
      goToStep(Math.max(currentStep - 1, 1));
    } else if (action === "submit-quiz") {
      // collect all data and submit
      const payload = collectAllQuizData();
      submitQuizData(payload);
      // hide quiz widget after submit to show recommendations in main dashboard
      hide(takeQuizWidget);
      // show dashboard but results will be rendered into recList
      showView("dashboard");
    } else if (action === "save-quiz") {
      const payload = collectAllQuizData();
      localStorage.setItem("cg_saved_incomplete", JSON.stringify({ payload, savedAt: Date.now() }));
      appendChatMessage("ai", "Quiz saved locally. You can continue later.");
    } else if (action === "view-roadmap") {
      // open roadmap panel or scroll to roadmap area
      const roadmapCard = document.getElementById("roadmapResult");
      roadmapCard && roadmapCard.scrollIntoView({ behavior: "smooth" });
    } else if (action === "save-college" || action === "save-rec") {
      // simple save logic
      const name = btn.getAttribute("data-college-name") || btn.closest(".rec-item")?.querySelector(".rec-title")?.innerText || "Saved item";
      const li = document.createElement("li");
      li.className = "saved-item";
      li.textContent = `${name} — saved`;
      savedList && savedList.prepend(li);
      appendChatMessage("ai", `${name} saved to your list.`);
    } else if (action === "view-college") {
      // show details modal if desired (not implemented)
      const colData = btn.getAttribute("data-college");
      appendChatMessage("ai", `College details: ${colData || "No details"}`);
    }
  });

  /* -------------------------
     Chat assistant form
     ------------------------- */
  if (chatForm) {
    chatForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const text = chatInput.value && chatInput.value.trim();
      if (!text) return;
      appendChatMessage("user", text);
      chatInput.value = "";

      // try backend assistant endpoint first
      try {
        const res = await fetch(`${BACKEND_URL}/assistant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text })
        });
        if (res.ok) {
          const payload = await res.json();
          appendChatMessage("ai", payload.reply || "(no reply)");
        } else {
          // fallback local echo
          appendChatMessage("ai", "Assistant currently unavailable. Try the quick quiz or check resources.");
        }
      } catch (err) {
        appendChatMessage("ai", "Assistant offline. Try again when connected.");
      }
    });
  }

  function appendChatMessage(who, text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = `chat-message ${who === "ai" ? "ai" : "user"}`;
    div.innerText = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /* -------------------------
     Initial UI wiring & nav links
     ------------------------- */
  // Start buttons on landing / welcome
  [startBtn, ctaStartQuiz].forEach(btn => {
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      // Hide landing (if present) & show quiz widget step 1
      landingQuiz && (landingQuiz.style.display = "none");
      showView("take-quiz");
    });
  });

  if (ctaBrowseColleges) {
    ctaBrowseColleges.addEventListener("click", (e) => {
      e.preventDefault();
      showView("colleges");
    });
  }

  // nav links
  navLinks.forEach(link => {
    link.addEventListener("click", (ev) => {
      ev.preventDefault();
      const view = link.getAttribute("data-view");
      showView(view);
    });
  });

  // default UI
  showView("dashboard");
  goToStep(1);

  /* -------------------------
     Load saved quiz if any
     ------------------------- */
  const savedIncomplete = localStorage.getItem("cg_saved_incomplete");
  if (savedIncomplete) {
    try {
      const parsed = JSON.parse(savedIncomplete);
      appendChatMessage("ai", "You have a saved quiz. Click 'Start Quiz' > Continue to restore answers.");
      // Optionally restore automatic - we keep it simple
    } catch (e) {
      console.warn("Invalid saved incomplete data", e);
    }
  }

  /* -------------------------
     Load initial college preview (from backend or fallback)
     ------------------------- */
  async function loadCollegePreview() {
    try {
      const res = await fetch(`${BACKEND_URL}/colleges`);
      if (!res.ok) throw new Error("No colleges endpoint");
      const list = await res.json();
      if (Array.isArray(list)) {
        mapListPreview.innerHTML = "";
        list.slice(0, 6).forEach(c => {
          const li = document.createElement("li");
          const name = c.name || c;
          li.textContent = `${name} — ${c.streams ? c.streams.join(", ") : ""} — ${c.distance_km ? `${c.distance_km} km` : ""}`;
          mapListPreview.appendChild(li);
        });
        nearbyCount && (nearbyCount.textContent = list.length);
      } else if (typeof list === "object") {
        // if backend returns structured object with keys (science/arts)
        const flattened = Object.values(list).flat();
        mapListPreview.innerHTML = "";
        flattened.slice(0, 6).forEach(c => {
          const li = document.createElement("li");
          const name = c.name || c;
          li.textContent = `${name} — ${c.streams ? c.streams.join(", ") : ""} — ${c.distance_km ? `${c.distance_km} km` : ""}`;
          mapListPreview.appendChild(li);
        });
        nearbyCount && (nearbyCount.textContent = flattened.length);
      }
    } catch (err) {
      console.warn("Could not load colleges preview:", err);
      mapListPreview.innerHTML = "<li>College preview unavailable (offline).</li>";
    }
  }
  loadCollegePreview();
});
