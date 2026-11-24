const { issue } = require('../src/services/creditService');
try { console.log(issue(Number(process.argv[2]))); }
catch (error) { console.error(error.message); process.exitCode = 1; }
