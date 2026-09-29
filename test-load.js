async function test() {
    console.log("Starting load test...");
    let success = 0;
    for(let i=0; i<25; i++) {
        console.log(`Sending request ${i+1}/25...`);
        const res = await fetch('http://localhost:3000/api/gemini/analyze-multiple-texts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                pages: [{ text: `Prueba de texto número ${i}. Este texto tiene que ser auditado por ortografía. Habia una ves un pato.`, name: `Page ${i}` }]
            })
        });
        if (res.ok) {
            success++;
            console.log(`Request ${i+1} SUCCESS`);
        } else {
            console.error(`Request ${i+1} FAILED:`, await res.text());
        }
    }
    console.log(`Test complete. Success: ${success}/25`);
}

test();
