document.getElementById("quizForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    // Collect answers
    const science = document.querySelector('input[name="science"]:checked')?.value;
    const maths = document.querySelector('input[name="maths"]:checked')?.value;
    const arts = document.querySelector('input[name="arts"]:checked')?.value;
    const local = document.querySelector('input[name="local"]:checked')?.value;
    const budget = document.querySelector('input[name="budget"]:checked')?.value;

    if (!science || !maths || !arts || !local || !budget) {
        alert("Please answer all questions!");
        return;
    }

    // Send to backend
    const response = await fetch("http://127.0.0.1:5000/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ science, maths, arts, local, budget })
    });

    const data = await response.json();

    // Display Stream
    document.getElementById("streamResult").innerHTML = `<h3>Suggested Stream: ${data.stream}</h3>`;

    // Display Colleges
    const collegeHTML = `<h3>Colleges:</h3><ul>${data.colleges.map(c =>
        `<li>${c.name} | Medium: ${c.medium} | Hostel: ${c.hostel ? "Yes" : "No"} | Distance: ${c.distance_km} km | Fees: ₹${c.fees}</li>`
    ).join("")}</ul>`;
    document.getElementById("collegeList").innerHTML = collegeHTML;

    // Display Careers
    const careerHTML = `<h3>Career Options:</h3><ul>${data.careers.map(c => `<li>${c}</li>`).join("")}</ul>`;
    document.getElementById("careerList").innerHTML = careerHTML;
});
