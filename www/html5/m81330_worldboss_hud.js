import {isWorldBossScene} from './m81330_protocol.js';
import {worldBossClock} from './m81330_state.js';
const number=value=>new Intl.NumberFormat('vi-VN').format(value);
const time=seconds=>seconds===null?'—:—':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;

export function worldBossHudRow(state,worldBoss,now=performance.now()){
  if(!isWorldBossScene(state)||!worldBoss?.received)return null;
  const {hp,maxHp,ownDamage,ownRank}=worldBoss;
  const clock=worldBossClock(worldBoss,now);
  return {hp,maxHp,ownDamage,ownRank,clock,
    frameIndex:Math.max(0,Math.min(99,Math.trunc(hp*100/maxHp)-1))};
}

/** WorldBossHPProxy uses the same native bossBloodBar.swf as PvE. The source
 * PveObjManager places its whole frame above worldHeight−120. */
export function drawWorldBossHud(view,state,now){
  const row=worldBossHudRow(state,view.client.state.worldBoss,now);
  const bar=view.prepared?.pveBossCatalog?.bossBar;
  if(!row||!bar)return;
  const frame=bar.frames[row.frameIndex],asset=frame?.asset||bar.asset;
  const image=view.store.image(asset);if(!frame||!image)return;
  const compact=!!view.touch?.isTouchViewport?.()||view.width<680||view.height<520;
  const scale=compact?Math.min(1,(view.width-24)/bar.width):1;
  const drawW=Math.round(bar.width*scale);
  const left=Math.trunc((view.width-drawW)/2);
  const safeTop=compact&&view.roboHud?.root?parseFloat(getComputedStyle(view.roboHud.root).paddingTop)||0:0;
  const top=compact?Math.round(safeTop+14):view.height-120-66;
  view.surface.draw(image,{sx:frame.sx,sy:frame.sy,sw:frame.w,sh:frame.h,
    x:left+(frame.offsetX+frame.w/2)*scale,y:top+(frame.offsetY+frame.h/2)*scale,width:frame.w*scale,height:frame.h*scale});
  const c=view.context;c.save();c.textAlign='center';c.textBaseline='top';
  c.font=`bold ${Math.max(11,Math.round(15*scale))}px Tahoma, sans-serif`;c.fillStyle='#fff';c.strokeStyle='#173847';c.lineWidth=3;
  const write=(text,y)=>{c.strokeText(text,view.width/2,y,view.width-16);c.fillText(text,view.width/2,y,view.width-16);};
  write(`Kẻ Hủy Diệt · ${number(row.hp)} / ${number(row.maxHp)} HP`,top+Math.round(6*scale));
  c.font=`bold ${Math.max(10,Math.round(13*scale))}px Tahoma, sans-serif`;c.fillStyle='#fff49a';
  write(`Sát thương: ${number(row.ownDamage)} · Hạng: ${row.ownRank||'—'} · ${row.clock.awaiting?'Chờ xác nhận kết thúc':time(row.clock.seconds)}`,top+Math.round(37*scale));
  c.restore();
}
