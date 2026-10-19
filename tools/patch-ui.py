"""Small integration fixes, kept as reproducible source edits."""
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'src/main.js'
s=p.read_text(encoding='utf-8')
s=s.replace("if(result===false||result===0)toast('没有找到匹配内容')", "if(!result?.count)toast('没有找到匹配内容');else $('cursor-status').textContent=`匹配 ${result.index+1} / ${result.count}`")
s=s.replace("current().title=rev.title;$('modal').close()", "current().title=rev.title;$('source-editor').value=rev.markdown;$('modal').close()")
p.write_text(s,encoding='utf-8')
