export function normalizeLines(source: string): {text: string; offsets: number[]}{
  let text='';const offsets=[];
  for(let i=0;i<source.length;i++){
    offsets.push(i);
    if(source[i]==='\r'){text+='\n';if(source[i+1]==='\n')i++;}
    else text+=source[i];
  }
  offsets.push(source.length);return {text,offsets};
}
