export type DailyMetric = 'captures' | 'cuts' | 'percent';
export type DailyChallenge = { day: string; metric: DailyMetric; target: number; title: string };
export type Records = { bestScore: number; highestLevel: number; attempts: number; wins: number; activeDays: string[]; claims: string[]; dailyDay: string; dailyValue: number };
export interface ProfileStorage { getItem(key:string):string|null; setItem(key:string,value:string):void }
const key='territory-profile-v1';
const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'});
const integer=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.floor(value)):fallback;
export function dayKey(date=new Date()):string {
  const parts=formatter.formatToParts(date);
  const part=(name:string)=>parts.find(p=>p.type===name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function dailyChallenge(day=dayKey()):DailyChallenge {
  const seed=Number(day.replaceAll('-',''))%3;
  return seed===0?{day,metric:'captures',target:3,title:'סגרו 3 מסלולי כיבוש בסיבוב אחד'}:
    seed===1?{day,metric:'cuts',target:2,title:'חתכו את שובל המחשב פעמיים בסיבוב אחד'}:
    {day,metric:'percent',target:35,title:'הגיעו ל־35% כיבוש בסיבוב אחד'};
}
export class PlayerProfile {
  records:Records;
  private storage?:ProfileStorage;
  constructor(storage?:ProfileStorage,previousTrophies=0){
    this.storage=storage;
    let raw:any={};try{raw=JSON.parse(storage?.getItem(key)||'{}')||{};}catch{/* A missing/corrupt profile starts fresh. */}
    const dates=(value:unknown)=>Array.isArray(value)?value.filter(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)).slice(-60):[];
    this.records={bestScore:integer(raw.bestScore),highestLevel:Math.max(1,integer(raw.highestLevel,1)),attempts:integer(raw.attempts),wins:integer(raw.wins,previousTrophies),activeDays:dates(raw.activeDays),claims:dates(raw.claims),dailyDay:typeof raw.dailyDay==='string'?raw.dailyDay:'',dailyValue:integer(raw.dailyValue)};
  }
  private save(){try{this.storage?.setItem(key,JSON.stringify(this.records));}catch{/* The session remains playable without storage. */}}
  start(day=dayKey()){this.records.attempts++;if(!this.records.activeDays.includes(day))this.records.activeDays.push(day);this.records.activeDays=this.records.activeDays.slice(-60);this.save();}
  win(){this.records.wins++;this.save();}
  observe(score:number,level:number,value:number,day=dayKey()){
    const r=this.records;
    const before=JSON.stringify(r);
    if(r.dailyDay!==day){r.dailyDay=day;r.dailyValue=0;}
    r.bestScore=Math.max(r.bestScore,integer(score));r.highestLevel=Math.max(r.highestLevel,integer(level,1));r.dailyValue=Math.max(r.dailyValue,integer(value));
    if(JSON.stringify(r)!==before)this.save();
  }
  dailyProgress(day=dayKey()){return this.records.dailyDay===day?this.records.dailyValue:0;}
  claimed(day=dayKey()){return this.records.claims.includes(day);}
  claim(day=dayKey()):boolean {
    if(this.claimed(day)||this.dailyProgress(day)<dailyChallenge(day).target)return false;
    this.records.claims.push(day);this.records.claims=this.records.claims.slice(-60);this.save();return true;
  }
}
export const publicGameUrl='https://asifeyal-gif.github.io/territory-game/play.html';
