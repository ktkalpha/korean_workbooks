// 지문 데이터 파일(data/passages/*.js)이 WB.register({...})로 자신을 등록한다.
window.WB = window.WB || {};
WB.passages = WB.passages || {};
WB.register = function (p) { WB.passages[p.id] = p; };
