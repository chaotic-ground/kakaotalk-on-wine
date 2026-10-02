// 시험에 필요한 전부. 프레임워크를 들이지 않는 이유는 둘이다. 확장이
// 실제로 도는 엔진이 gjs이고 gjs는 모든 GNOME 기계에 이미 있다. 그리고
// 이 저장소에는 package.json도 node_modules도 없고, 스무 줄 때문에
// 생길 이유가 없다.
//
//   gjs -m test/classify.test.js
let failures = 0;
let checks = 0;

export function is(actual, expected, what) {
    checks++;
    if (actual === expected)
        return;
    failures++;
    print(`  FAIL ${what}\n    기대: ${expected}\n    실제: ${actual}`);
}

export function done(name) {
    if (failures) {
        print(`${name}: ${failures}/${checks} 실패`);
        imports.system.exit(1);
    }
    print(`${name}: ${checks}개 통과`);
}
