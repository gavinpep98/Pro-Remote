// Slide Desk · Copyright (C) 2026 Gavin Peppers · Contributors: Crossroads Community Church, Athens, GA
// SPDX-License-Identifier: GPL-3.0-or-later  (see LICENSE.txt and COPYRIGHT.txt)
/*
 * Pretend ProPresenter used by the Slide Desk demos (sample songs, playlists, props, Looks, media...).
 * Answers the same requests as ProPresenter's network API. Runs in Node (Start Demo) and in a
 * browser (the online demo). Nothing here talks to a real ProPresenter.
 */
(function (root) {
function createFakePro() {
const C=(r,g,b)=>({red:r,green:g,blue:b,alpha:1});
const songs={
 AG:{name:'Amazing Grace',bg:['#1b2a4a','#3a1f3d'],groups:[
  {uuid:'g1',name:'Verse 1',color:C(0,.47,.8),slides:['Amazing grace how sweet the sound\nThat saved a wretch like me','I once was lost but now am found\nWas blind but now I see']},
  {uuid:'g2',name:'Verse 2',color:C(0,.35,.6),slides:['’Twas grace that taught my heart to fear\nAnd grace my fears relieved','How precious did that grace appear\nThe hour I first believed']},
  {uuid:'g3',name:'Chorus',color:C(.85,.25,.3),slides:['Through many dangers, toils and snares\nI have already come','’Tis grace hath brought me safe thus far\nAnd grace will lead me home']}],
  arr:['g1','g3','g2','g3'],notes:{1:'Band drops out — keys only'}},
 WS:{name:'Welcome Slides',bg:['#14352e','#1d2b45'],groups:[{uuid:'w',name:'Welcome',color:C(.25,.75,.5),slides:['Welcome to Crossroads','Connect Card\nText CONNECT to 55555','Kids check-in opens at 9:30']}]},
 GG:{name:'Blessed Assurance',bg:['#3a2a12','#2a1838'],groups:[
  {uuid:'h1',name:'Verse 1',color:C(0,.47,.8),slides:['Blessed assurance, Jesus is mine\nO what a foretaste of glory divine','Heir of salvation, purchase of God\nBorn of His Spirit, washed in His blood']},
  {uuid:'h2',name:'Chorus',color:C(.85,.25,.3),slides:['This is my story, this is my song\nPraising my Savior all the day long','This is my story, this is my song\nPraising my Savior all the day long']},
  {uuid:'h3',name:'Bridge',color:C(.6,.3,.85),slides:['Perfect submission, all is at rest\nI in my Savior am happy and blest']}]},
 SR:{name:'Sermon — Romans 8',bg:['#222','#2b2b38'],groups:[{uuid:'s',name:'Sermon',color:C(1,.6,.2),slides:['No Condemnation\nRomans 8','Romans 8:1\nThere is therefore now no condemnation…','Romans 8:28\nAll things work together for good…']}]},
 AN:{name:'Announcements — October',bg:['#2d1f10','#14253a'],groups:[{uuid:'a',name:'Announcements',color:C(.95,.75,.2),slides:['Fall Festival\nOct 31 · 5 PM','Youth Retreat\nSign up by Oct 20','Baptism Sunday\nNov 2']}]},
};
// like ProPresenter: triggers use the plain slide number; the live position follows the arrangement
const rawToCue=(k,raw)=>{const s=songs[k];let n=0,G=null,o=0;for(const g of s.groups){if(raw<n+g.slides.length){G=g.uuid;o=raw-n;break}n+=g.slides.length}
 if(!G)return 0;const ids=s.arr||s.groups.map(g=>g.uuid);let pos=0;for(const id of ids){const g=s.groups.find(x=>x.uuid==id);if(id==G)return pos+o;pos+=g.slides.length}return 0};
const cuesOf=k=>{const s=songs[k];const ids=s.arr||s.groups.map(g=>g.uuid);return ids.flatMap(id=>s.groups.find(g=>g.uuid==id).slides)};
let live={p:'AG',i:3,item:'i3'};let CAP=0;const MEDIALOG=[];let NEWLOOK=null;let VI=false;let SLIDE_ON=true;let AUD_ON=true,STAGE_ON=true;let MSG_ON=false;const PUTS=[];
const MP={mp1:['Ocean Waves Loop','Aurora Flow','Soft Bokeh','Gold Particles','Sunrise Clouds','Blue Light Leaks','Abstract Waves','Starfield','Mountain Mist','Ember Glow'],mp2:['Countdown 5:00','Countdown 3:00','Countdown 1:00'],mp3:Array.from({length:230},(_,i)=>'Stock Clip '+String(i+1).padStart(3,'0'))};
const AP={ap1:[['Gratitude','Brandon Lake',338],['Holy Forever','Chris Tomlin',301],['Firm Foundation','Cody Carnes',284],['Same God','Elevation Worship',356]],ap2:[['Transition Swell','',8],['Applause','',12]]};
const TP={presentation:{name:'Ocean Waves Loop',duration:184.5,t:63.2,playing:true,at:Date.now()},announcement:{name:'Fall Festival Promo',duration:45,t:12,playing:false,at:Date.now()},audio:{name:'Gratitude',artist:'Brandon Lake',duration:338,t:95,playing:true,at:Date.now()}};
const tnow=l=>{const x=TP[l];if(x.playing){x.t=Math.min(x.duration,x.t+(Date.now()-x.at)/1000)}x.at=Date.now();return x.t};
const pl=[{id:{uuid:'h1',name:'Pre-Service'},type:'header'},{id:{uuid:'i0',name:'Countdown 5:00',index:1},type:'media',is_hidden:false,is_pco:false,media_info:{media_uuid:'mp2-0',name:'Countdown 5:00'},target_uuid:'mp2-0'},{id:{uuid:'i1',name:'Welcome Slides'},type:'presentation',presentation_info:{presentation_uuid:'WS'}},{id:{uuid:'i2',name:'Announcements — October'},type:'presentation',presentation_info:{presentation_uuid:'AN'}},
 {id:{uuid:'h2',name:'Worship'},type:'header'},{id:{uuid:'i3',name:'Amazing Grace'},type:'presentation',presentation_info:{presentation_uuid:'AG',arrangement_uuid:'ARR',arrangement_name:'Sunday'}},{id:{uuid:'i4',name:'Blessed Assurance'},type:'presentation',presentation_info:{presentation_uuid:'GG'}},
 {id:{uuid:'h3',name:'Message'},type:'header'},{id:{uuid:'i5',name:'Sermon — Romans 8'},type:'presentation',presentation_info:{presentation_uuid:'SR'}},{id:{uuid:'i6',name:'Walk-out Music'},type:'audio'}];
const tree=[{id:{uuid:'f1',name:'2026 Services'},field_type:'group',children:[{id:{uuid:'pl1',name:'Sunday Oct 11'},field_type:'playlist'},{id:{uuid:'pl2',name:'Sunday Oct 18'},field_type:'playlist'},{id:{uuid:'pl3',name:'Wednesday Night'},field_type:'playlist'}]},{id:{uuid:'pco',name:'October 18, 2026'},field_type:'playlist'},{id:{uuid:'pl4',name:'Christmas Eve'},field_type:'playlist'}];
const libs={L1:{name:'Songs',items:['10,000 Reasons','Amazing Grace','Build My Life','Cornerstone','Blessed Assurance','Great Are You Lord','Holy Forever','Living Hope','O Come to the Altar','What A Beautiful Name']},
 L2:{name:'Service Elements',items:['Announcements — October','Baptism Sunday','Communion','Offering','Prayer','Welcome Slides']},
 L3:{name:'Sermons',items:['Sermon — Romans 8','Sermon — Psalm 23','Sermon — John 15']},
 L4:{name:'Misc.',items:['Amazing Grace (example)','Countdown Slides']}};
const idFor=n=>({'Amazing Grace':'AG','Blessed Assurance':'GG','Welcome Slides':'WS','Sermon — Romans 8':'SR','Announcements — October':'AN'})[n]||('x'+[...n].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7).toString(16));
const PC={"prop_collections": {"collections": [{"id": {"uuid": "74146D80-674C-4667-902E-B7C689E76470", "name": "Pre-Service", "index": 0}, "props": [{"id": {"uuid": "B74BEA89-CD8C-4661-825D-97F47F1113FA", "name": "Pre1", "index": 0}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}], "single_prop_enabled": false}, {"id": {"uuid": "C3F82A91-B980-42E3-BF6D-65C1AF955FCF", "name": "Worship", "index": 1}, "props": [{"id": {"uuid": "0C6ADFB3-8DAA-44C8-A33C-2997646BD143", "name": "Prop", "index": 0}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "987F666E-23D7-4231-B54B-79794DEF4279", "name": "Prop 1", "index": 1}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "CDF7E9C1-88AA-47F2-81AA-E65FBDC0EBB3", "name": "Prop 2", "index": 2}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "8C438F04-4861-443E-87A3-C5F5D38C5BD3", "name": "Prop 3", "index": 3}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "ADA8D840-470F-4561-8386-81AAA202FCC7", "name": "Prop 4", "index": 4}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "B0F77F3F-EFBD-458B-8063-3EF05549BA8D", "name": "Prop 4 2", "index": 5}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "0E666742-AA90-4CFE-9B7F-CB371A851936", "name": "Prop 4 1", "index": 6}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}], "single_prop_enabled": false}, {"id": {"uuid": "9A935275-E4F5-44DE-BDB8-31D5D27353CF", "name": "Announcements", "index": 2}, "props": [{"id": {"uuid": "394FA1D7-453C-43F6-AE66-D18476B3D1F7", "name": "Prop", "index": 0}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}], "single_prop_enabled": false}, {"id": {"uuid": "6EB3F26D-D4A0-482D-A942-0ED9F8836271", "name": "Jesus Moment", "index": 3}, "props": [{"id": {"uuid": "4D6DFA82-9533-48B2-AC53-5DEAA68EAFE4", "name": "HOLY FOREVER", "index": 0}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "DC60C5D5-D8A3-412C-8D01-8252F7A6DE8C", "name": "HOLY FOREVER 1", "index": 1}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "F759FE8C-5EDB-4D6D-872A-69994FC4EADF", "name": "Recieve Joy", "index": 2}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 10.0, "transition": null}, {"id": {"uuid": "BA78A121-5610-4A20-BFD2-DDB83EB86F51", "name": "Yes he's Mine", "index": 3}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 15.0, "transition": null}, {"id": {"uuid": "EE619979-7CCD-418B-96C1-7918F9076604", "name": "Hell or High Water", "index": 4}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 20.0, "transition": null}, {"id": {"uuid": "B489F61D-17C9-457B-8E3B-51DF4E9EE778", "name": "Thats Why I Owe You 1", "index": 5}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 10.0, "transition": null}, {"id": {"uuid": "2D0B1E9F-6483-4737-9054-C52489971652", "name": "Blessed Assurance", "index": 6}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "1781ACBF-6BDE-4FF9-8DCD-DF3FFEDA09D9", "name": "Praise The Lord My Soul", "index": 7}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 15.0, "transition": null}, {"id": {"uuid": "DA9DBC75-F5F7-408F-B0E1-324B7453CD9F", "name": "Come Jesus Come", "index": 8}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 10.0, "transition": null}, {"id": {"uuid": "2BF4530E-E293-4B84-94B9-7FB54224E032", "name": "Come Jesus Come 1", "index": 9}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 45.0, "transition": {"uuid": "EC52A828-AD85-4602-B70C-1DEE7C904DB6", "name": "Dissolve", "duration": 0.0}}, {"id": {"uuid": "91E74D80-1550-41D4-9B6B-6288E01B1779", "name": "Great are you lord", "index": 10}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 10.0, "transition": null}, {"id": {"uuid": "9E8C818D-99C6-4B1B-A60F-F10F44D6779A", "name": "Made For More", "index": 11}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}, {"id": {"uuid": "B6D68135-7440-47E4-B414-D81AAF7C42B4", "name": "What A God", "index": 12}, "is_active": false, "auto_clear_enabled": true, "auto_clear_duration": 60.0, "transition": {"uuid": "EC52A828-AD85-4602-B70C-1DEE7C904DB6", "name": "Dissolve", "duration": 0.0}}], "single_prop_enabled": false}, {"id": {"uuid": "BB1F488C-E6F0-4B20-AE8F-30E2206DAE45", "name": "Sermon", "index": 4}, "props": [{"id": {"uuid": "BD4DC17E-3B1C-4DB4-8545-BBF644EE174B", "name": "Prop", "index": 0}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}], "single_prop_enabled": true}, {"id": {"uuid": "59C0BA9B-77F5-455E-891E-08837575EE6A", "name": "Lyric fade", "index": 5}, "props": [{"id": {"uuid": "6A99C6B6-9306-4F47-A27E-4E809984778B", "name": "Emmanuel", "index": 0}, "is_active": false, "auto_clear_enabled": false, "auto_clear_duration": 0.0, "transition": null}], "single_prop_enabled": false}]}};
for(const c of PC.prop_collections.collections)for(const p of c.props)if(p.id.name=='Pre1'||p.id.name=='HOLY FOREVER')p.is_active=true;
let look='k2';const LOOKS=[{id:{uuid:'k1',name:'Default',index:0}},{id:{uuid:'k2',name:'Sunday Worship',index:1}},{id:{uuid:'k3',name:'Sermon',index:2}},{id:{uuid:'k4',name:'Stream Only',index:3}},{id:{uuid:'k5',name:'Lobby + Stage',index:4}}];
const stage={s1:'L1',s2:'L2',s3:'L3'};const SL=[['L1','Bible Study'],['L2','Operator View'],['L3','Multi-View 1'],['L4','Current/Next'],['L5','Lyrics Only']];
const macros=[['m0','Pre-Service'],['m1','Walk-in'],['m2','Worship'],['m3','Prayer'],['m4','Sermon'],['m5','Response'],['m6','Dismissal'],['m7','Reset All']];
const esc=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const svg=(bg,text,big)=>{const l=String(text).split('\n');const fs1=big?84:62;return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/>${l.map((s,i)=>`<text x="640" y="${360-(l.length-1)*45+i*90+22}" fill="#fff" font-family="Helvetica, Arial" font-size="${i==0&&l.length>1&&big?fs1+8:fs1}" font-weight="${i==0&&big?700:400}" text-anchor="middle">${esc(s)}</text>`).join('')}</svg>`};
  function handle(method, url, body) {
    const q = { method, url };
    const out = { status: 200, type: '', body: '' };
    const r = {
      writeHead(s, h) { out.status = s; out.type = (h && h['content-type']) || ''; },
      end(b) { out.body = b == null ? '' : String(b); }
    };
    (function () {
const u=decodeURIComponent(q.url.split('?')[0]);let m;
const j=o=>{r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify(o))};const ok=()=>{r.writeHead(204);r.end()};const img=s=>{r.writeHead(200,{'content-type':'image/svg+xml'});r.end(s)};
if(u=='/v1/capture/status'){const t=CAP?Math.floor((Date.now()-CAP)/1000)+754:0;const f=n=>String(n).padStart(2,'0');return j({status:CAP?'active':'inactive',capture_time:CAP?`${f(Math.floor(t/3600))}:${f(Math.floor(t%3600/60))}:${f(t%60)}`:'00:00:00'})}
if(u=='/v1/capture/start'){CAP=Date.now();return ok()}
if(u=='/v1/capture/stop'){CAP=0;return ok()}
if(u=='/v1/capture/settings')return j({source:{type:'audience',name:'Audience'},destination:'disk',disk:{location:'/Users/crossroads/Movies/ProPresenter',file_name:'Sunday Service',codec:'H.264',resolution:{width:1920,height:1080},frame_rate:30},rtmp:{url:'rtmp://a.rtmp.youtube.com/live2',key:'abcd-1234-secret'}});
{let mm=u.match(/^\/v1\/transport\/(presentation|announcement|audio)\/(current|time|play|pause|skip_forward|skip_backward)(?:\/(\d+))?$/);if(mm){const L=mm[1],x=TP[L];tnow(L);
 if(mm[2]=='current'&&!x.name)return ok();
 if(mm[2]=='current')return j({uuid:'v-'+L,name:x.name,artist:x.artist||'',audio_only:false,duration:x.duration});
 if(mm[2]=='time'){if(q.method=='PUT'){x.t=parseFloat(body);return ok()}return j(+x.t.toFixed(2))}
 if(mm[2]=='play'){x.playing=true;return ok()} if(mm[2]=='pause'){x.playing=false;return ok()}
 if(mm[2]=='skip_forward'){x.t=Math.min(x.duration,x.t+ +mm[3]);return ok()} if(mm[2]=='skip_backward'){x.t=Math.max(0,x.t-+mm[3]);return ok()}}}
if(u=='/v1/media/playlists')return j([{id:{uuid:'mf',name:'Backgrounds',index:0},field_type:'group',children:[{id:{uuid:'mp1',name:'Worship Motions',index:0},field_type:'playlist'},{id:{uuid:'mp2',name:'Countdowns',index:1},field_type:'playlist'}]},{id:{uuid:'mp3',name:'Stock Library',index:1},field_type:'playlist'}]);
{const mm=u.match(/^\/v1\/media\/playlist\/(mp\d)$/);if(mm){const st=+(new URL(q.url,'http://x').searchParams.get('start')||0);const src=MP[mm[1]];MEDIALOG.push(mm[1]+'@'+st);return j({id:{uuid:mm[1],name:''},items:src.slice(st,st+100).map((n,i)=>({id:{uuid:mm[1]+'-'+(st+i),name:n,index:st+i},type:'video'}))})}}
{const mm=u.match(/^\/v1\/media\/(mp\d-\d+)\/thumbnail$/);if(mm){const [p,i]=mm[1].split('-');const hue=(+i*37+(p=='mp1'?200:p=='mp2'?20:120))%360;return img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><radialGradient id="r" cx="30%" cy="30%" r="90%"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue+60)%360},60%,15%)"/></radialGradient></defs><rect width="320" height="180" fill="url(#r)"/><circle cx="${60+(+i*53)%200}" cy="${40+(+i*29)%100}" r="40" fill="rgba(255,255,255,.12)"/></svg>`)}}
{const mm=u.match(/^\/v1\/trigger\/media\/(mp\d)\/(mp\d-\d+)$/);if(mm){const [p,i]=mm[2].split('-');Object.assign(TP.presentation,{name:MP[p][+i],t:0,duration:120,playing:true,at:Date.now()});return ok()}}
if(u=='/v1/audio/playlists')return j([{id:{uuid:'ap1',name:'Walk-in Music',index:0},field_type:'playlist'},{id:{uuid:'ap2',name:'Sound Effects',index:1},field_type:'playlist'}]);
{const mm=u.match(/^\/v1\/audio\/playlist\/(ap\d)$/);if(mm){const L=AP[mm[1]];return j({id:{uuid:mm[1],name:''},items:L.map(([n,a,d],i)=>({id:{uuid:mm[1]+'-'+i,name:n,index:i},artist:a,duration:d,type:'audio'}))})}}
{const mm=u.match(/^\/v1\/trigger\/audio\/(ap\d)\/(ap\d-\d+)$/);if(mm){const [p,i]=mm[2].split('-');const [n,a,d]=AP[p][+i];Object.assign(TP.audio,{name:n,artist:a,duration:d,t:0,playing:true,at:Date.now()});return ok()}}
if(u=='/__medialog')return j(MEDIALOG);
if(u=='/v1/video_inputs')return j([{id:{uuid:'vi1',name:'Camera 1 — Center',index:0}},{id:{uuid:'vi2',name:'Camera 2 — Wide',index:1}},{id:{uuid:'vi3',name:'Camera 3 — Band',index:2}},{id:{uuid:'vi4',name:'NDI — Stream PC',index:3}}]);
if(/^\/v1\/trigger\/video_input\/vi\d$/.test(u)){VI=true;return ok()}
{const cl=u.match(/^\/v1\/clear\/layer\/(\w+)$/);if(cl){const L=cl[1];
 if(L=='slide')SLIDE_ON=false;
 if(L=='media')TP.presentation.name='';
 if(L=='audio'){TP.audio.name='';TP.audio.artist='';}
 if(L=='announcements')TP.announcement.name='';
 if(L=='props')for(const c of PC.prop_collections.collections)for(const p of c.props)p.is_active=false;
 if(L=='messages')MSG_ON=false;
 if(L=='video_input')VI=false;
 return ok()}}
if(u=='/v1/masks')return j([{id:{uuid:'mk1',name:'Center Safe Area',index:0}},{id:{uuid:'mk2',name:'Lower Third',index:1}},{id:{uuid:'mk3',name:'Left Side Panel',index:2}}]);
{const mm=u.match(/^\/v1\/mask\/(mk\d)\/thumbnail$/);if(mm){const hole={mk1:'<rect x="40" y="22" width="240" height="136" fill="#fff"/>',mk2:'<rect x="0" y="120" width="320" height="60" fill="#fff"/>',mk3:'<rect x="0" y="0" width="120" height="180" fill="#fff"/>'}[mm[1]];return img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#000"/>${hole}</svg>`)}}
if(u=='/version')return j({name:'Demo Computer',platform:'mac',host_description:'ProPresenter 21.4',api_version:'v1'});
const cues=cuesOf(live.p);
if(u=='/v1/status/slide')return j({current:{text:cues[live.i],notes:(songs[live.p].notes||{})[live.i]||''},next:{text:cues[live.i+1]||'',notes:''}});
if(u=='/v1/presentation/slide_index')return j({presentation_index:{index:live.i,presentation_id:{uuid:live.p,name:songs[live.p].name},total_cues:cues.length,remaining_cues:cues.length-1-live.i}});
if(u=='/v1/status/layers')return j({slide:SLIDE_ON,media:!!TP.presentation.name,props:PC.prop_collections.collections.some(c=>c.props.some(p=>p.is_active)),messages:MSG_ON,announcements:!!TP.announcement.name,audio:!!TP.audio.name,video_input:VI});
if(u=='/v1/status/audience_screens'){if(q.method=='PUT'){AUD_ON=JSON.parse(body)===true;return ok()}return j(AUD_ON)}
if(u=='/v1/status/stage_screens'){if(q.method=='PUT'){STAGE_ON=JSON.parse(body)===true;return ok()}return j(STAGE_ON)}
if(u=='/v1/playlist/focused')return j({playlist:{uuid:'pco',name:'October 18, 2026'},item:{},playlist_item:{id:{uuid:'pp1',name:'Blessed Assurance - [ Sunday ]',index:4},type:'presentation',is_hidden:false,is_pco:true,presentation_info:{presentation_uuid:'GG',arrangement_name:'Sunday',arrangement_uuid:''}}});
if(u=='/v1/playlist/active')return j({presentation:{playlist:{uuid:'pl1',name:'Sunday Oct 11'},playlist_item:pl.find(x=>x.id.uuid==live.item)}});
const scr=()=>[{id:{uuid:'sc1',name:'Audience',index:0},mask:null,enabled:true,slide:true,media:true,video_input:true,announcements:false,props:true,messages:true},{id:{uuid:'sc2',name:'Stream',index:1},mask:{uuid:'mk2',name:'Lower Third',index:1},enabled:true,slide:true,media:false,video_input:true,announcements:false,props:false,messages:false},{id:{uuid:'sc3',name:'Lobby TVs',index:2},mask:null,enabled:false,slide:false,media:true,video_input:false,announcements:true,props:false,messages:false}];
for(const l of LOOKS)if(!l.screens)l.screens=scr();
if(u=='/v1/look/current')return j(LOOKS.find(l=>l.id.uuid==look));
if(u=='/v1/looks'&&q.method=='POST'){const b=JSON.parse(body);NEWLOOK=b;const id='k'+(LOOKS.length+1)+Date.now()%1000;LOOKS.push({id:{uuid:id,name:b.id.name,index:LOOKS.length},screens:b.screens||scr()});return j(LOOKS[LOOKS.length-1])}
{const mm=u.match(/^\/v1\/look\/(k\w+)$/);if(mm){const i=LOOKS.findIndex(l=>l.id.uuid==mm[1]);if(i<0){r.writeHead(404);return r.end()}
 if(q.method=='PUT'){const b=JSON.parse(body);LOOKS[i]={...LOOKS[i],...b,id:{...LOOKS[i].id,name:b.id.name}};return j(LOOKS[i])}
 if(q.method=='DELETE'){LOOKS.splice(i,1);return ok()}
 return j(LOOKS[i])}}
if(u=='/__newlook')return j(NEWLOOK);
if(u=='/v1/looks')return j(LOOKS.map(l=>({id:l.id})));
if(m=u.match(/^\/v1\/look\/(\w+)\/trigger$/)){look=m[1];return ok()}
if(m=u.match(/^\/v1\/presentation\/(\w+)$/)&&songs[u.split('/')[3]]){const k=u.split('/')[3],s=songs[k];return j({presentation:{id:{uuid:k,name:s.name},groups:s.groups.map(g=>({uuid:g.uuid,name:g.name,color:g.color,slides:g.slides.map((t,i)=>({text:t,enabled:true,notes:'',label:''}))})),arrangements:s.arr?[{id:{uuid:'ARR',name:'Sunday'},groups:s.arr},{id:{uuid:'ARR2',name:'Short'},groups:s.arr.slice(0,2)}]:[],current_arrangement:s.arr?'ARR':''}})}
if(m=u.match(/^\/v1\/presentation\/(\w+)\/thumbnail\/(\d+)$/)){const s=songs[m[1]];if(!s){r.writeHead(404);return r.end()}return img(svg(s.bg,cuesOf(m[1])[+m[2]]||'',s===songs.SR||s===songs.AN||s===songs.WS))}
if(m=u.match(/^\/v1\/presentation\/(\w+)\/(\d+)\/trigger$/)){SLIDE_ON=true;if(songs[m[1]]){live={p:m[1],i:rawToCue(m[1],+m[2]),item:null}}return ok()}
if(m=u.match(/^\/v1\/trigger\/cue\/(\d+)$/)){const n=cuesOf(live.p).length;if(+m[1]<n){live={...live,i:+m[1]};SLIDE_ON=true}return ok()}
if(m=u.match(/^\/v1\/trigger\/playlist\/pl1\/(\w+)\/(\d+)$/)){SLIDE_ON=true;const it=pl.find(x=>x.id.uuid==m[1]);live={p:it.presentation_info.presentation_uuid,i:rawToCue(it.presentation_info.presentation_uuid,+m[2]),item:m[1]};return ok()}
if(u=='/v1/trigger/next'){SLIDE_ON=true;if(live.i<cues.length-1)live.i++;return ok()}
if(u=='/v1/trigger/previous'){SLIDE_ON=true;if(live.i>0)live.i--;return ok()}
if(u=='/v1/playlists')return j(tree);
if(u=='/v1/playlist/pl1'){if(q.method=='PUT'){PUTS.push(body);
 // like ProPresenter 21.4: every item must say what it points at (target_uuid), or the whole list is refused
 const list=JSON.parse(body);let col=1;
 for(const it of list){col+=JSON.stringify(it).length+1;if(!it.target_uuid){r.writeHead(400,{'content-type':'text/plain'});r.end('Json deserialize error: missing field `target_uuid` at line 1 column '+col);return}}
 // and when read back, only media items show target_uuid
 pl.splice(0,pl.length,...list.map(it=>{if(it.type!='media'&&it.type!='audio'){const c={...it};delete c.target_uuid;return c}return it}));return ok()}
 return j({id:{uuid:'pl1',name:'Sunday Oct 11'},items:pl})}
if(u=='/__puts')return j(PUTS);
if(m=u.match(/^\/v1\/playlist\/(pl\d)$/))return j({id:{uuid:m[1],name:''},items:[]});
if(u.startsWith('/v1/playlist/')){r.writeHead(404);return r.end()}
if(u=='/v1/libraries')return j(Object.entries(libs).map(([k,l],i)=>({uuid:k,name:l.name,index:i})));
if(m=u.match(/^\/v1\/library\/(\w+)$/))return j({update_type:'all',items:libs[m[1]].items.map((n,i)=>({uuid:idFor(n),name:n,index:i}))});
if(u=='/v1/prop_collections')return j(PC);
if(u=='/v1/props'){r.writeHead(404);return r.end()}
if(m=u.match(/^\/v1\/prop\/([\w-]+)\/thumbnail$/)){let n='';for(const c of PC.prop_collections.collections)for(const p of c.props)if(p.id.uuid==m[1])n=c.id.name=='Jesus Moment'?p.id.name:c.id.name+' · '+p.id.name;
  return img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#000"/><rect x="18" y="128" width="284" height="36" rx="5" fill="#ff8a3d"/><text x="160" y="152" fill="#1a0d03" font-size="15" font-weight="700" font-family="Helvetica" text-anchor="middle">${esc(n.toUpperCase())}</text></svg>`)}
if(m=u.match(/^\/v1\/prop\/([\w-]+)\/(trigger|clear)$/)){for(const c of PC.prop_collections.collections)for(const p of c.props)if(p.id.uuid==m[1])p.is_active=m[2]=='trigger';return ok()}
if(u=='/v1/macros')return j(macros.map(([k,n],i)=>({id:{uuid:k,name:n,index:i}})));
if(u=='/v1/macro_collections')return j({macro_collections:{collections:[{id:{uuid:'c1',name:'Service Flow',index:0},macros:macros.slice(0,7).map(([k,n],i)=>({id:{uuid:k,name:n,index:i}}))},{id:{uuid:'c2',name:'Utility',index:1},macros:[{id:{uuid:'m7',name:'Reset All',index:0}}]}]}});
if(u=='/v1/timers')return j([{id:{uuid:'t1',name:'Service Countdown'}},{id:{uuid:'t2',name:'Sermon Clock'}},{id:{uuid:'t3',name:'Worship Set'}}]);
if(u=='/v1/timers/current')return j([{id:{uuid:'t1'},time:'04:37',state:'running'},{id:{uuid:'t2'},time:'35:00',state:'stopped'},{id:{uuid:'t3'},time:'12:08',state:'running'}]);
if(u=='/v1/stage/screens')return j([{uuid:'s1',name:'Confidence 1',index:0},{uuid:'s2',name:'Operator View',index:1},{uuid:'s3',name:'MultiView',index:2}]);
if(u=='/v1/stage/layouts')return j(SL.map(([k,n],i)=>({id:{uuid:k,name:n,index:i}})));
if(u=='/v1/stage/layout_map')return j(Object.entries(stage).map(([s,l],i)=>({screen:{uuid:s,name:'',index:i},layout:{uuid:l,name:'',index:0}})));
if(m=u.match(/^\/v1\/stage\/layout\/(\w+)\/thumbnail$/)){const n=SL.find(x=>x[0]==m[1])[1];return img(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0b0b0b"/><rect x="12" y="12" width="190" height="104" fill="#1e2a44"/><rect x="212" y="12" width="96" height="104" fill="#2a2235"/><text x="16" y="160" fill="#fc0" font-size="20" font-family="Helvetica">${esc(n)}</text></svg>`)}
if(m=u.match(/^\/v1\/stage\/screen\/(\w+)\/layout\/(\w+)$/)){stage[m[1]]=m[2];return ok()}
ok();
    })();
    return out;
  }
  return handle;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createFakePro };
else root.createFakePro = createFakePro;
})(typeof window !== 'undefined' ? window : globalThis);
