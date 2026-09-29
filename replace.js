const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// The block we want to replace starts with:
// while (running < 1 && queueIndex < totalPgs) {
//   const i = queueIndex++;
//   running++;
//   setAnalysisStatus...
//   processPage...

let replaced = false;
content = content.replace(/while \(running < 1 && queueIndex < totalPgs\) \{\s*const i = queueIndex\+\+;\s*running\+\+;\s*setAnalysisStatus\([^;]+;\s*processPage\(extractedPages\[i\], i\)\s*\.then\(\(\) => \{\s*(?:\/\/.*?\s*)?setTimeout\(\(\) => \{\s*running--;\s*next\(\);\s*\}, 4000\);\s*\}\);\s*\}/, (match) => {
    replaced = true;
    return \while (running < 3 && queueIndex < totalPgs) {
                const i = queueIndex++;
                running++;
                setAnalysisStatus('Auditando página ' + Math.min(completedPages + 1, totalPgs) + ' de ' + totalPgs + '... (Modo rápido)');
                processPage(extractedPages[i], i).then(() => {
                    setTimeout(() => {
                        running--;
                        next();
                    }, 500);
                });
              }\;
});

console.log('Replaced?', replaced);
fs.writeFileSync('src/App.tsx', content, 'utf8');
