const fs=require('fs'),path=require('path'),ts=require('../frontend/node_modules/typescript');
for(const file of process.argv.slice(2)){
 const p=path.resolve('frontend/src',file);let src=fs.readFileSync(p,'utf8');
 const edits=JSON.parse(fs.readFileSync(path.join(__dirname,file+'.json'),'utf8'));
 for(const [s,e,v]of edits.sort((a,b)=>b[0]-a[0]))src=src.slice(0,s)+v+src.slice(e);
 const names={'App.tsx':['Modal','ChordPopover','ChordCreator','Lyrics','App'],'playerStems.tsx':['StemControls']}[file]||[file.replace('.tsx','')];
 const sf=ts.createSourceFile(file,src,99,true,ts.ScriptKind.TSX),inserts=[];
 function walk(n){if((ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n))&&n.name&&names.includes(n.name.text)&&n.body)inserts.push(n.body.getStart(sf)+1);ts.forEachChild(n,walk);}walk(sf);
 for(const at of inserts.sort((a,b)=>b-a))src=src.slice(0,at)+'\n  const { t, locale, setLocale, formatDate } = useI18n();'+src.slice(at);
 src='import { useI18n, translateError'+(file==='App.tsx'?', I18nProvider':'')+' } from "./i18n";\n'+src;
 src=src.replace(/\{(error|job\.error|stems\.error|warning)\}/g,'{translateError(locale, $1)}');
 if(file==='App.tsx'){
  src=src.replace('export default function App() {','function AppContent() {');
  src+='\nexport default function App() {\n  return <I18nProvider><AppContent /></I18nProvider>;\n}\n';
  src=src.replace('new Date(s.updatedAt).toLocaleDateString("ru-RU")','formatDate(s.updatedAt)').replace(/\.toLocaleLowerCase\(\)/g,'.toLocaleLowerCase(locale)');
  src=src.replace('confirm(\n                              "Удалить раздел вместе со строками? Это можно отменить.",','confirm(\n                              t("Удалить раздел вместе со строками? Это можно отменить."),');
  src=src.replaceAll('states[song.id] || t("Сохранено")','t(states[song.id] || "Сохранено")');
  src=src.replace('<h1>{t("Настройки")}</h1>','<h1>{t("Настройки")}</h1>\n            <section>\n              <h2>{t("Язык интерфейса")}</h2>\n              <label>\n                {t("Язык интерфейса")}\n                <select value={locale} onChange={(event) => setLocale(event.target.value as "ru" | "en")}>\n                  <option value="ru">Русский</option>\n                  <option value="en">English</option>\n                </select>\n              </label>\n            </section>');
 }
 if(file==='TimingEditor.tsx')src=src.replaceAll('{label}','{t(label)}');
 if(file==='AnalysisPanel.tsx')src=src.replace('stages[job.stage || ""] || labels[job.status]','t(stages[job.stage || ""] || labels[job.status])').replace(': labels[job.status]}',': t(labels[job.status])}');
 if(file==='SourceSearch.tsx')src=src.replace('? state.error','? translateError(locale, state.error)').replace(': source.note || ""',': translateError(locale, source.note || "")');
 if(file==='lrcImport.tsx')src=src.replace(': row.reason}',': translateError(locale, row.reason || "")}');
 if(file==='playerStems.tsx')src=src.replace('{status.note}','{translateError(locale, status.note || "")}').replace('job.stageLabel ??','translateError(locale, job.stageLabel || "") ||');
 // Trim unused destructured context values independently in every component.
 const sf2=ts.createSourceFile(file,src,99,true,ts.ScriptKind.TSX),clean=[];
 function cleanup(n){if((ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n))&&n.body&&n.name&&names.concat('AppContent').includes(n.name.text)){
  const hook='const { t, locale, setLocale, formatDate } = useI18n();',body=n.body.getText(sf2);
  if(body.includes(hook)){const rest=body.replace(hook,''),values=['t','locale','setLocale','formatDate'].filter(v=>new RegExp('\\b'+v+'\\b').test(rest));const at=src.indexOf(hook,n.body.getStart(sf2));clean.push([at,at+hook.length,'const { '+values.join(', ')+' } = useI18n();']);}}
  ts.forEachChild(n,cleanup);}cleanup(sf2);
 for(const [s,e,v]of clean.sort((a,b)=>b[0]-a[0]))src=src.slice(0,s)+v+src.slice(e);
 fs.writeFileSync(p,src);
}
