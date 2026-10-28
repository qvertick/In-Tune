const fs = require('fs'), path = require('path');
const ts = require('../frontend/node_modules/typescript');
const dir = path.resolve('frontend/src');
const keys = new Set();
const inventory=[];
function text(s) {
 const lines=s.replace(/\r/g,'').split('\n');
 return lines.map((s,i)=>{s=s.replace(/\t/g,' ');if(i)s=s.trimStart();if(i<lines.length-1)s=s.trimEnd();return s;}).filter(Boolean).join(' ');
}
function ui(n){for(let p=n.parent;p;p=p.parent){if(ts.isJsxExpression(p)||ts.isJsxAttribute(p))return true;if(ts.isArrowFunction(p)||ts.isFunctionDeclaration(p)||ts.isBlock(p))return false;if(ts.isCallExpression(p)&&/^(set\w+|mutate|update|api|JSON\.stringify)$/.test(p.expression.getText()))return false;}return false;}
function message(n,sf){
 let key,params=[];
 if(ts.isJsxText(n))key=text(n.text);
 else if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))key=n.text;
 else if(ts.isTemplateExpression(n)){key=n.head.text;n.templateSpans.forEach((s,i)=>{let name=ts.isIdentifier(s.expression)?s.expression.text:'value'+i;params.push(name+': '+s.expression.getText(sf).replace('"конец строки"','t("конец строки")'));key+='{'+name+'}'+s.literal.text;});}
 if(!key||!/[А-Яа-яЁё]/.test(key))return;
 keys.add(key);return {key,code:'t('+JSON.stringify(key)+(params.length?', { '+params.join(', ')+' }':'')+')'};
}
for(const file of ['App.tsx','SourceSearch.tsx','SongStatus.tsx','SyncMarker.tsx','AnalysisPanel.tsx','TimingEditor.tsx','playerStems.tsx','lrcImport.tsx','Performance.tsx','playerTiming.ts','lrc.ts','useVoiceFollow.ts','playerMedia.ts','api.ts']){
 const p=path.join(dir,file),src=fs.readFileSync(p,'utf8'),sf=ts.createSourceFile(file,src,99,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),edits=[];
 function visit(n){if(ts.isJsxText(n)||((ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n))&&ui(n))){let r=message(n,sf);if(r){edits.push([n.getStart(sf),n.end,(ts.isJsxText(n)||ts.isJsxAttribute(n.parent))?'{'+r.code+'}':r.code]);inventory.push({file,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,...r});return;}}ts.forEachChild(n,visit);}visit(sf);
 function collect(n){message(n,sf);ts.forEachChild(n,collect);}collect(sf);
 fs.writeFileSync(path.join(__dirname,file+'.json'),JSON.stringify(edits));
}
fs.writeFileSync(path.join(__dirname,'keys.json'),JSON.stringify([...keys],null,2));
fs.writeFileSync(path.join(__dirname,'inventory.json'),JSON.stringify(inventory,null,2));
