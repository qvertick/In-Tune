const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('../frontend/node_modules/typescript');
function dictionary(file){const exp={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('frontend/src/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exp});return exp.default;}
const all={...dictionary('messages.ts'),...dictionary('errorMessages.ts'),...dictionary('extraMessages.ts')};
const missing=new Set();
for(const file of fs.readdirSync('frontend/src').filter(f=>/\.tsx?$/.test(f)&&!f.includes('.test.')&&!['messages.ts','errorMessages.ts','extraMessages.ts'].includes(f))){
 const src=fs.readFileSync('frontend/src/'+file,'utf8'),sf=ts.createSourceFile(file,src,99,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function literals(n){if(ts.isStringLiteral(n)&&/[А-Яа-яЁё]/.test(n.text)&&all[n.text]===undefined){console.log(file+': '+JSON.stringify(n.text));missing.add(n.text);}ts.forEachChild(n,literals);}
 function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(sf)==='t'&&n.arguments[0])literals(n.arguments[0]);else ts.forEachChild(n,visit);}visit(sf);
 if(false){console.log('RAW '+file);function raw(n){if((ts.isStringLiteral(n)||ts.isTemplateExpression(n))&&/[А-Яа-яЁё]/.test(n.getText(sf)))console.log(n.getText(sf));ts.forEachChild(n,raw);}raw(sf);}
}
fs.writeFileSync('.i18n-work/missing.json',JSON.stringify([...missing],null,2));
