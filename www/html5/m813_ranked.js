/* Local ranked matches: server-owned rating, season, history and map selection. */
import {element,flashSpriteButton,flashProgressBar,setText} from './m8_ui_helpers.js';
import {battleMapName} from './m810_modes.js';
import {rankQueueSeconds} from './m81337_rooms_ui.js';

const LADDER_ART=Object.freeze({
  panelBg:'/rez/zh_CN/gui_summer/controls/ladder/099bd1898592fd54ccdfcf86d0ca1c66.png',
  rankBox:'/rez/zh_CN/gui_summer/controls/ladder/2460561c52d2d371018343aadd9852be.png',
  viewRankWord:'/rez/zh_CN/gui_summer/controls/ladder/b59a54031703c518a3abaa34d1130c85.png',
  topTenWord:'/rez/zh_CN/gui_summer/controls/ladder/f1f4cf1446093d58422f765f695e1694.png',
});

function artImg(src,alt,className=''){
  const img=element('img',null,className);
  img.src=src;img.alt=alt;img.draggable=false;img.decoding='async';
  return img;
}

export function buildRankedPanel(ui,{button,art}){
  const root=element('section',null,'m813-rank-panel');root.dataset.testid='rank-panel';
  const generation=ui.client.generation,account=ui.state.accountId;
  const current=()=>root.isConnected&&generation===ui.client.generation&&account===ui.state.accountId;

  const panelBg=artImg(LADDER_ART.panelBg,'','m813-rank-panel-bg');
  const banner=element('div',null,'m813-rank-banner');
  const tierFrameHost=element('div',null,'m813-rank-frame');
  const headerBar=element('div',null,'m813-rank-banner-header');
  const title=element('h2','Đấu xếp hạng 5v5'),season=element('p','Đang đọc mùa giải…','m813-season');
  headerBar.append(title,season);
  const bannerFooter=element('div',null,'m813-rank-banner-footer');
  const bannerCopy=element('div',null,'m813-rank-banner-copy');
  const description=element('p','Ghép 2 người ở hai phe · Bot bổ sung đủ 5v5 · Bản đồ ngẫu nhiên','m813-rank-description');
  const rule=element('p','Thắng +150 · Thua −15 · Hòa 0 · Khởi đầu 1.000 điểm','m813-rank-rule');
  bannerCopy.append(description,rule);
  const topTen=artImg(LADDER_ART.topTenWord,'Top 10 người chơi qua huy chương Kim Cương được lên Tổng Chỉ Huy','m813-rank-top10');
  bannerFooter.append(bannerCopy,topTen);
  banner.append(tierFrameHost,headerBar,bannerFooter);

  const card=element('div',null,'m813-rank-card');
  const boxBg=artImg(LADDER_ART.rankBox,'','m813-rank-box-bg');
  const cardMain=element('div',null,'m813-rank-card-main');
  const badge=element('div',null,'m813-rank-badge'),summary=element('div',null,'m813-rank-summary');
  const rankName=element('h3','—'),rating=element('p','—','m813-rank-rating');
  summary.append(rankName,rating);
  cardMain.append(badge,summary);
  const record=element('p','—','m813-rank-record');
  const progress=flashProgressBar(ui.assets,0,{width:214,height:11,className:'m813-rank-progress'});
  progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Tiến độ hạng');
  progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','50');
  card.append(boxBg,cardMain,record,progress);

  const history=element('div',null,'m813-rank-history');history.hidden=true;

  const footer=element('div',null,'m813-rank-footer');
  const rules2=element('p','Chờ tối đa 5 giây; người lẻ đấu với bot. Loại bot tự chọn theo rank. Mỗi mùa 14 ngày. Rời trận tính là thua.','m813-rank-rule2');
  const actions=element('div',null,'m813-rank-actions');
  const ranking=flashSpriteButton(ui,'zh_CN/gui_summer/controls/public/button_2_blue.png','',()=>ui.navigate('leaderboard',{rankKind:'ranked'}),{width:142,height:32,testId:'rank-open-leaderboard',ariaLabel:'Bảng xếp hạng',title:'Bảng xếp hạng'});
  ranking.append(artImg(LADDER_ART.viewRankWord,'Xem bảng xếp hạng','m813-rank-word-btn'));
  const historyButton=flashSpriteButton(ui,'zh_CN/gui_summer/controls/public/button_2_blue.png','Lịch sử 20 trận',()=>{
    const showHistory=history.hidden;
    history.hidden=!showHistory;banner.hidden=showHistory;
    const label=historyButton.querySelector('.m8-flash-btn-label')||historyButton;
    setText(label,showHistory?'Thông tin mùa':'Lịch sử 20 trận');
  },{width:132,height:32,testId:'rank-history-toggle'});
  const refresh=flashSpriteButton(ui,'zh_CN/gui_summer/controls/public/button_2_green.png','Làm mới',()=>load(),{width:98,height:32,testId:'rank-status-refresh'});
  actions.append(ranking,historyButton,refresh);
  footer.append(rules2,actions);

  root.append(panelBg,banner,history,card,footer);

  const join=button(ui,'button_red_m','Tìm trận rank',()=>ui.run(()=>ui.state.multiplayer?.queue.active?ui.client.cancelRanked():ui.client.startRanked()),546,442,{testId:'rank-play'});
  const sword=ui.assets.get?.('flow.ico_pvp')||ui.assets.get?.('ico_pvp');
  const joinCaption=element('span','Tìm trận rank','m81337-rank-caption');
  join.append(joinCaption);
  const joinIcon=sword?art(ui,'ico_pvp',564,451):null;
  const hint=element('p','Ghép người thật trước; đủ thời gian sẽ tự bổ sung bot.','m813-rank-join-hint m81337-rank-hint');hint.setAttribute('role','status');
  ui.content.append(root,art(ui,'quickplay_bk_4',534,429),join,...(joinIcon?[joinIcon]:[]),hint);

  let data=null,receivedAt=0,loading=false,stale=false;
  function render(){
    if(!data||data.error)return;
    rankName.textContent=data.challenger?'Thách Đấu':data.section.name;
    rating.textContent=`${data.rating.toLocaleString('vi-VN')} điểm · Hạng ${data.rank||'—'}`;
    record.textContent=`${data.played} trận: ${data.wins} thắng · ${data.losses} thua · ${data.draws} hòa`;
    const pointsInTier=Math.max(0,data.rating-data.section.threshold);
    progress.hidden=data.section.type===6;progress.setProgress(pointsInTier/50);progress.setAttribute('aria-valuenow',String(pointsInTier));
    badge.replaceChildren();
    const icon=ui.assets.get(ui.assets.flowPresentation?.sectionIcons?.[String(data.section.type)]);
    if(icon){const emblem=ui.assets.menuArt(icon,rankName.textContent,'m813-rank-emblem',{animate:false});badge.append(emblem);}
    const frameKey=ui.assets.flowPresentation?.sectionFrames?.[String(Math.max(1,data.section.type||1))]||`flow.sectionFrame${Math.max(1,Math.min(6,data.section.type||1))}`;
    const frameAsset=ui.assets.get(frameKey);
    tierFrameHost.replaceChildren(...(frameAsset?[artImg(frameAsset.url,'','m813-rank-frame-img')]:[]));
    history.replaceChildren();
    if(!data.history.length)history.append(element('p','Chưa có trận hoàn tất.','m813-history-empty'));
    for(const row of data.history){
      const line=element('article',null,'m813-history-row');line.dataset.matchUuid=row.match_uuid;
      const outcome={win:'Thắng',loss:'Thua',draw:'Hòa'}[row.outcome]||row.outcome;
      const when=new Date(row.ended_at*1000).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false});
      const text=`${outcome}${row.forfeit?' (rời trận)':''} · ${row.ranked?'Rank':'So tài'} · ${battleMapName(row.map_id)}`;
      const points=row.ranked?(row.expired_season?'Mùa đã lưu trữ hết hạn':`${row.delta>=0?'+':''}${row.delta} điểm`):'';
      line.append(element('strong',text),element('span',`${when}${points?' · '+points:''}`));
      const self=row.roster.find(p=>p.account_id===account);if(self)line.title=`K/D/A: ${self.kills}/${self.deaths}/${self.assists}`;
      history.append(line);
    }
  }
  async function load(){
    if(loading)return;loading=true;refresh.disabled=true;
    try{
      const next=await ui.client.publicQuery('crankstatus.php',{char:ui.state.meta.character.charUuid||String(account)});
      if(!current())return;data=next;receivedAt=Date.now();stale=false;
      if(data.error)throw new Error(data.error);render();tick();
    }catch(error){if(current())season.textContent=error.message;}finally{loading=false;if(current())refresh.disabled=false;}
  }
  function tick(){
    join.disabled=ui.state.phase!=='ready'||ui.state.play.phase!=='lobby'||!!ui.state.play.busy;
    const queue=ui.state.multiplayer?.queue;
    joinCaption.textContent=queue?.active?'Hủy tìm trận':'Tìm trận rank';
    join.setAttribute('aria-label',joinCaption.textContent);join.title=joinCaption.textContent;
    hint.textContent=queue?.active?(queue.status==='reserved'?'Đã ghép trận. Đang vào chọn tank…':
      `Đang tìm đối thủ · còn ${rankQueueSeconds(ui.state)} giây trước khi ghép bot.`):'Ghép người thật trước; đủ thời gian sẽ tự bổ sung bot.';
    if(!current()||!data?.season)return;
    const now=data.server_time+(Date.now()-receivedAt)/1000,seconds=Math.max(0,Math.ceil(data.season.ends_at-now));
    const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);
    season.textContent=`Mùa ${data.season.id} · Còn ${days} ngày ${hours} giờ ${minutes} phút`;
    if(!seconds&&!stale){stale=true;load();}
  }
  queueMicrotask(load);return {root,tick,load};
}
