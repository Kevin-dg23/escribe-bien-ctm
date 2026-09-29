async function testAPI() {
    console.log("Testing analyze-multiple-texts (Simulated digital PDF)...");
    
    // Simulate 2 pages of text
    const pages = [
        { name: "Página 1", text: "Hola esto es un texto con erores de horgrafia." },
        { name: "Página 2", text: "Y aki hay otra paginna q tmbn tiene e-rores." }
    ];
    
    let res = await fetch('http://localhost:3000/api/gemini/analyze-multiple-texts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages })
    });
    
    if (res.ok) {
        console.log("Digital PDF mode SUCCESS:", await res.json());
    } else {
        console.error("Digital PDF mode FAILED:", await res.text());
    }
}
testAPI();
