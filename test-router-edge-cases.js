import { classifyIntent } from './src/plugins/llm/rule_router.js';

const cases = [
    { text: "Could we have a meeting tonight ?", expect: "chat" },
    { text: "Hey, could we have a meeting tommorow", expect: "chat" },
    { text: "can we have a meeting today", expect: "chat" },
    { text: "Lets fix the meeting at 10", expect: "calendar_tool" },
    { text: "Meeting at 10", expect: "calendar_tool" },
    { text: "Shoot at 10", expect: "calendar_tool" },
    { text: "Class starts at 8am tommorow", expect: "calendar_tool" },
    { text: "Assignment for social marketing due tommorow", expect: "calendar_tool" }
];

let passed = 0;
console.log("--- Edge Case Testing ---");
cases.forEach((c, idx) => {
    const result = classifyIntent(c.text);
    const success = result === c.expect;
    if (success) passed++;

    console.log(`[Test ${idx + 1}] ${success ? '✅' : '❌'}`);
    console.log(`Input: "${c.text}"`);
    console.log(`Got: ${result} | Expected: ${c.expect}\\n`);
});

console.log(`Passed ${passed}/${cases.length} tests.`);
