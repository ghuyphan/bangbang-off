import {element,assetImage,nativeText,numberText,selectInput,note,flashCloseButton,flashSpriteButton} from './m8_ui_helpers.js';
import {at,panelArt,panelAsset,nativeButton,nativeLabel} from './m84_character.js';
import {createNativePanel} from './m81_native_panel.js';
import {canonicalShopIntent,shopItemReference} from './m81345_shop_protocol.js';

const P='zh_CN/gui_summer/controls/';
const comma=value=>Math.max(0,Number(value)||0).toLocaleString('en-US');
const ROLE_VI={
  '刺客':'Sát thủ','射手':'Xạ thủ','法师':'Pháp sư','战士':'Đấu sĩ','肉盾':'Đỡ đòn','辅助':'Hỗ trợ',
  '位移':'Cơ động','控制':'Khống chế','爆发':'Bùng nổ','复制':'Phân thân','灵动':'Linh hoạt',
  '护盾':'Tạo giáp','沉默':'Câm lặng','拉扯':'Cấu rỉa','瞬移':'Dịch chuyển','禁疗':'Cấm hồi máu',
  '狙击':'Bắn tỉa','收割':'Kết liễu','积攒':'Tích lũy','重伤':'Trọng thương','潜行':'Tàng hình',
  '击退':'Đẩy lùi','弹射':'Nảy đạn','单体':'Đơn mục tiêu','反隐':'Chống tàng hình','穿透':'Xuyên giáp',
  '群伤':'Diện rộng','吸血':'Hút máu','生存':'Sinh tồn','保护':'Bảo vệ','先手':'Mở giao tranh',
  '冰冻':'Đóng băng','净化':'Thanh tẩy','减益':'Suy yếu','击飞':'Hất tung','分割':'Chia cắt',
  '分身':'Phân thân','制裁':'Trừng phạt','加速':'Tăng tốc','反弹':'Phản đòn','反杀':'Phản kích',
  '变身':'Biến hình','召唤':'Triệu hồi','回溯':'Quay ngược','增益':'Cường hóa','恐惧':'Hoảng sợ',
  '恢复':'Hồi phục','抵挡':'Chống đỡ','换血':'Đổi máu','新手':'Tân thủ','暴击':'Bạo kích',
  '治疗':'Hồi máu','消失':'Biến mất','消耗':'Cấu rỉa','混乱':'Hỗn loạn','石化':'Hóa đá',
  '突进':'Đột kích','群体':'Diện rộng','群控':'Khống chế rộng','群疗':'Hồi máu nhóm',
  '自愈':'Tự hồi phục','范围':'Diện rộng','补刀':'Kết liễu','转移':'Chuyển vị','连射':'Liên thanh',
  '遁地':'Độn thổ','重生':'Hồi sinh','防弹':'Chắn đạn','陷阱':'Đặt bẫy','隐身':'Tàng hình',
  '骚扰':'Quấy rối','魅惑':'Mê hoặc','不朽':'Bất tử','休眠':'Ngủ đông',
};
const formatRole=raw=>!raw?'':raw.split(/\s+|·/).map(t=>t.trim()).filter(Boolean).map(t=>ROLE_VI[t]||t).join(' · ');
const coinIconKey=type=>type===1?'money':type===3?'coupon':'diamond';
export const NORMAL_SHOP_TABS=Object.freeze([1,2,4,5,6,7]);
export const normalShopType=value=>typeof value==='string'&&/^normal:(1|2|4|5|6|7)$/.test(value);
export const shopCurrencyName=type=>({1:'Xu',2:'Bạc',3:'Xu Khóa'})[type]||'Tiền';
const currencyField=type=>({1:'cash',2:'golden',3:'silver'})[type];
const whole=(value,min=0,max=0x7fffffff)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const label=value=>typeof value==='string'&&value.length<=10000;
export function validShopIcon(value){
  if(!object(value)||typeof value.url!=='string'||!/^\/(?:html5|rez)\/[A-Za-z0-9_./-]+\.(?:png|webp|jpg|jpeg|gif)$/.test(value.url)
    ||value.url.includes('..')||!whole(value.width,1,16384)||!whole(value.height,1,16384)
    ||typeof value.sha256!=='string'||!(/^[a-f0-9]{64}$/).test(value.sha256))return false;
  const f=value.frame;
  return f===undefined||object(f)&&whole(f.x)&&whole(f.y)&&whole(f.w,1)&&whole(f.h,1)&&f.x+f.w<=value.width&&f.y+f.h<=value.height;
}
export function validateNormalShopCatalog(value){
  if(!object(value)||value.v!==1||!(/^[a-f0-9]{64}$/).test(value.revision)||!Array.isArray(value.tabs)
    ||!Array.isArray(value.offers)||value.offers.length>1000||!object(value.boxes))throw new Error('Danh mục cửa hàng chưa hợp lệ. Hãy làm mới danh mục.');
  if(value.topup_packs!==undefined&&(!Array.isArray(value.topup_packs)||value.topup_packs.length>8
    ||value.topup_packs.some(pack=>!object(pack)||!whole(pack.vouchers,1,99)||!whole(pack.xu,1))))
    throw new Error('Danh mục nạp mô phỏng chưa hợp lệ.');
  const seen=new Set();
  for(const offer of value.offers){
    if(!object(offer)||!whole(offer.goodsId,1,0xffffffff)||seen.has(offer.goodsId)||!whole(offer.itemId,1,0xffffffff)
      ||!NORMAL_SHOP_TABS.includes(offer.tab)||offer.available!==true||!label(offer.name)||!label(offer.description||'')
      ||!validShopIcon(offer.icon)||!Array.isArray(offer.payments)||!offer.payments.length||offer.payments.length>2
      ||offer.payments.some(p=>!object(p)||!['primary','alternate'].includes(p.key)||![1,2,3].includes(p.coinType)
        ||!whole(p.price)||!whole(p.quantity,1))||new Set(offer.payments.map(p=>p.key)).size!==offer.payments.length)
      throw new Error('Có mặt hàng chưa đủ dữ liệu hoặc hình ảnh. Chưa mở giao dịch; hãy làm mới danh mục.');
    seen.add(offer.goodsId);
  }
  for(const [key,box] of Object.entries(value.boxes)){
    if(!object(box)||String(box.itemId)!==key||!label(box.name)||!['random','fixed'].includes(box.mode)
      ||box.mode==='random'&&(box.main_percent!==10||box.material_percent!==90||!Array.isArray(box.main_rewards)||!box.main_rewards.length
        ||!Array.isArray(box.material_rewards)||!box.material_rewards.length)
      ||box.mode==='fixed'&&(!Array.isArray(box.fixed_rewards)||!box.fixed_rewards.length))
      throw new Error('Thông tin hộp quà chưa đầy đủ. Hãy làm mới danh mục.');
  }
  return value;
}
export function normalShopBox(ui,itemId){return ui.cache?.normalShop?.boxes?.[String(itemId)]||null;}
export function normalShopOffer(ui,itemId){return ui.cache?.normalShop?.offers?.find(offer=>offer.itemId===itemId)||null;}
export function canUseNormalShop(ui){
  return !ui.disposed&&!ui.pending&&!ui.snapshot?.normalShop?.pending&&!ui.snapshot?.economy?.pending
    &&ui.snapshot?.phase==='ready'&&ui.snapshot?.play?.phase==='lobby'&&!ui.snapshot?.play?.busy;
}
function canRecover(ui){return !ui.disposed&&!ui.pending&&ui.snapshot?.phase==='ready'&&!ui.snapshot?.play?.busy;}
function blocker(ui){
  if(ui.snapshot?.normalShop?.pending)return 'Giao dịch trước đang chờ kiểm tra kết quả.';
  if(ui.snapshot?.economy?.pending)return 'Kiểm tra giao dịch kho đang chờ trước.';
  return ui.snapshot?.play?.phase!=='lobby'?'Về sảnh để mua hoặc mở vật phẩm.':'Đang chờ máy chủ xác nhận.';
}
export function normalShopIcon(icon,name='',className='',width=160,height=140){
  if(!validShopIcon(icon))return null;
  const box=element('span',null,'m81345-shop-icon '+className),image=assetImage(icon,name);
  Object.assign(box.style,{display:'inline-block',position:'relative',overflow:'hidden',width:`${width}px`,height:`${height}px`,flexShrink:'0'});
  if(icon.frame){
    const f=icon.frame,scale=Math.min(width/f.w,height/f.h);
    Object.assign(image.style,{position:'absolute',maxWidth:'none',maxHeight:'none',width:`${icon.width*scale}px`,height:`${icon.height*scale}px`,
      left:`${(width-f.w*scale)/2-f.x*scale}px`,top:`${(height-f.h*scale)/2-f.y*scale}px`});
    box.dataset.nativeFrame=[f.x,f.y,f.w,f.h].join(',');
  }else{
    // Avoid bilinear upscaling on crisp square item art (>=48px) so shop cards stay sharp.
    const cap=Math.min(width,height),nativeMax=Math.max(icon.width||0,icon.height||0);
    const drawW=nativeMax>=48&&icon.width<=width?icon.width:width;
    const drawH=nativeMax>=48&&icon.height<=height?icon.height:height;
    Object.assign(image.style,{position:'absolute',left:`${(width-drawW)/2}px`,top:`${(height-drawH)/2}px`,width:`${drawW}px`,height:`${drawH}px`,objectFit:'contain'});
  }
  box.append(image);return box;
}
export function normalShopVisual(ui,offer,width=160,height=140){
  const assets=ui?.assets,itemId=Number(offer?.itemId);
  if(offer?.grantKind==='tank'&&assets?.portraitForTank&&Number.isInteger(itemId)){
    const size=Math.min(width,height),holder=element('span',null,'m81345-shop-icon m81345-shop-portrait');
    Object.assign(holder.style,{display:'grid',placeItems:'center',position:'relative',width:`${width}px`,height:`${height}px`,flexShrink:'0'});
    holder.append(assets.portraitForTank({tankId:itemId,level:1},{size,animate:true}));
    return holder;
  }
  if(offer?.grantKind==='skin'&&assets?.createPortrait&&Number.isInteger(itemId)){
    const skin=(assets.garage?.skins||[]).find(row=>Number(row.itemId)===itemId||Number(row.skinId)===itemId);
    const ext=skin?.externalId;
    if(ext&&assets.hud?.portraits?.[String(ext)]){
      const size=Math.min(width,height),holder=element('span',null,'m81345-shop-icon m81345-shop-portrait');
      Object.assign(holder.style,{display:'grid',placeItems:'center',position:'relative',width:`${width}px`,height:`${height}px`,flexShrink:'0'});
      holder.append(assets.createPortrait(ext,{size,animate:true}));
      return holder;
    }
  }
  return normalShopIcon(offer?.icon,offer?.name||'','',width,height);
}
const rewardText=reward=>`${nativeText(reward.name)} ×${numberText(reward.quantity)}`;
export function shopReceiptText(receipt){
  if(!receipt)return 'Đã đồng bộ giao dịch theo máy chủ.';
  const prefix=receipt.outcome==='topup'?'Đã đổi phiếu':receipt.outcome==='purchase'?'Đã mua':receipt.outcome==='main'?'Đã mở, nhận phần thưởng chính':receipt.outcome==='material'?'Đã mở, nhận nguyên liệu':'Đã nhận quà';
  return `${prefix}: ${(receipt.rewards||[]).map(rewardText).join(', ')}.`;
}
function rulesText(box){return box?.mode==='random'?'Mỗi lần mở: 10% phần thưởng chính · 90% nguyên liệu.':box?.mode==='fixed'?'Gói quà cố định.':'';}
function maxQuantity(offer){return whole(offer?.maxCount,1,99)?offer.maxCount:1;}
function openDialog(ui,values){
  if(ui.disposed)return;
  ui.confirmation={kind:'normal-shop',epoch:ui.epoch,generation:ui.client.generation,identity:ui.identity,
    stage:'choose',busy:false,notice:'',preview:null,returnFocus:document.activeElement?.dataset?.testid,...values};ui.render();
}
export function openNormalShopPurchase(ui,offer){
  if(!canUseNormalShop(ui)||!offer?.available)return;
  openDialog(ui,{mode:'buy',goods:structuredClone(offer),payment:offer.payments[0].key,quantity:1});
}
export function openNormalShopBox(ui,item,container){
  if(!canUseNormalShop(ui)||!normalShopBox(ui,item.templateId))return;
  openDialog(ui,{mode:'open_box',item:structuredClone(item),container,quantity:1});
}
export async function openSimulatedTopup(ui){
  if(!canUseNormalShop(ui)||!ui.snapshot.play.setup?.classic)return;
  await ui.queryServer('normalShop','capi/normalshopquery.php',{},!!ui.cache.normalShop?.queryError);
  if(!canUseNormalShop(ui)||ui.section!=='shop')return;
  const packs=ui.cache.normalShop?.topup_packs;
  if(!packs?.length){
    ui.message=ui.cache.normalShop?.queryError||'Chưa tải được gói nạp mô phỏng.';
    ui.messageError=true;ui.render();return;
  }
  openDialog(ui,{mode:'topup',packs,pack:packs[0].vouchers});
}
export function openNormalShopRecovery(ui){
  if(!canRecover(ui))return;
  ui.client.restoreShopPending?.();ui.snapshot=ui.client.snapshot?.()||ui.snapshot;
  openDialog(ui,{mode:'recover'});
}
export function renderNormalShopRecovery(ui,parent,{shop=false}={}){
  if(!ui.snapshot?.normalShop?.pending)return;
  const row=element('div',null,'m81345-shop-recovery');
  row.append(element('span','Giao dịch cửa hàng chưa rõ kết quả.'),ui.button('Kiểm tra kết quả',()=>openNormalShopRecovery(ui),
    {testId:'shop-reconcile-open',disabled:!canRecover(ui)}));
  if(shop)at(row,239,571,746,34);parent.append(row);
}
export function renderNormalShopGoods(ui,body){
  const catalog=ui.cache.normalShop,tab=Number(ui.shopType.split(':')[1]);
  const firstTank=tab===2&&!ui.snapshot.meta.tanks.length;
  const currency=ui.snapshot.meta?.character?.currency||{};
  const ownedTankIds=new Set((ui.snapshot.meta?.tanks||[]).filter(t=>t.containerType===0).map(t=>Number(t.tankId)));
  const ownedSkinIds=new Set((ui.snapshot.meta?.containers?.['6']?.items||[]).filter(i=>i.count>0).map(i=>Number(i.templateId)));
  const query=(ui.query||'').trim().toLocaleLowerCase('vi');
  const isAffordable=offer=>offer.payments.some(p=>Number(currency[currencyField(p.coinType)]||0)>=p.price);
  const rows=(catalog?.offers||[]).filter(offer=>offer.tab===tab
    &&(!firstTank||offer.grantKind==='tank'&&offer.payments.some(p=>p.coinType===3&&p.price<=399))
    &&(!query||nativeText(offer.name).toLocaleLowerCase('vi').includes(query)||nativeText(offer.description||'').toLocaleLowerCase('vi').includes(query))
    &&(ui.shopSub!=='gift'||offer.payments.some(p=>p.coinType===3))
    &&(ui.shopSub!=='cash'||offer.payments.some(p=>p.coinType===1))
    &&(!ui.shopAffordable||isAffordable(offer)));
  const pages=Math.max(1,Math.ceil(rows.length/3));ui.page=Math.max(0,Math.min(Number(ui.page)||0,pages-1));
  const cards=at(element('div',null,'m84-shop-cards m81345-shop-cards'),235,139,750,380);
  for(const [index,offer] of rows.slice(ui.page*3,ui.page*3+3).entries()){
    const card=at(element('article',null,'m84-shop-card m81345-shop-card'),index*250,0,250,380),name=nativeText(offer.name),payment=offer.payments[0],box=normalShopBox(ui,offer.boxId||offer.itemId);
    const owned=(offer.grantKind==='tank'&&ownedTankIds.has(Number(offer.itemId)))||(offer.grantKind==='skin'&&ownedSkinIds.has(Number(offer.itemId)));
    card.dataset.goodsId=String(offer.goodsId);card.dataset.itemId=String(offer.itemId);
    card.append(panelArt(ui,P+'shop/bigGoodsCard.png',-2,-2));
    const title=nativeLabel(name,10,13,230,27,{align:'center',className:'m84-shop-card-name'});title.title=name;card.append(title);
    const icon=normalShopVisual(ui,offer,160,138);if(icon)card.append(at(icon,45,48,160,138));
    const description=at(element('p',nativeText(offer.description||''),'m81345-shop-description'),17,196,216,74);description.title=description.textContent;card.append(description);
    const tankMeta=offer.grantKind==='tank'?formatRole(ui.assets?.garage?.tanks?.[String(offer.itemId)]?.nativeRole):'';
    const detail=box?rulesText(box):tankMeta||(payment.quantity>1?`Số lượng: ×${comma(payment.quantity)}`:'');
    if(detail)card.append(at(element('p',detail,'m81345-shop-card-rule'),12,274,226,20));
    const preferred=ui.shopSub==='gift'?(offer.payments.find(p=>p.coinType===3)||payment):ui.shopSub==='cash'?(offer.payments.find(p=>p.coinType===1)||payment):payment;
    const alt=offer.payments.find(p=>p.key!==preferred.key);
    const price=at(element('div',null,'m84-shop-price'),10,302,230,26);
    if(owned){
      price.title=`Đã sở hữu vĩnh viễn · ${comma(preferred.price)} ${shopCurrencyName(preferred.coinType)}`;
      price.append(element('span','Đã sở hữu'));
    }else{
      const shown=alt?[preferred,alt]:[preferred];
      shown.forEach((p,idx)=>{
        if(idx>0){const sep=element('span','/');sep.className='m84-shop-price-sep';price.append(sep);}
        const coin=panelAsset(ui,P+`shop/${coinIconKey(p.coinType)}.png`);
        if(coin){const img=panelArt(ui,coin);Object.assign(img.style,{position:'static',width:'22px',height:'22px'});price.append(img);}
        price.append(element('span',`${comma(p.price)}${p.quantity>1?`×${comma(p.quantity)}`:''}`));
      });
      if(alt)price.title=`${comma(preferred.price)} ${shopCurrencyName(preferred.coinType)} · Hoặc ${comma(alt.price)} ${shopCurrencyName(alt.coinType)}`;
      const affordable=isAffordable(offer);
      card.append(nativeButton(ui,{skin:P+'shop/button_buy_t.png',label:'Mua '+name,x:80,y:338,testId:'normal-shop-buy-'+offer.goodsId,
        disabled:!canUseNormalShop(ui)||!affordable,title:!canUseNormalShop(ui)?blocker(ui):affordable?'Mua '+name:'Chưa đủ tiền.',
        onClick:()=>openNormalShopPurchase(ui,offer)}));
    }
    card.append(price);cards.append(card);
  }
  body.append(cards,ui.nativePager('shop',pages,body));
  if(!rows.length){
    const status=catalog?.queryError||(ui.loading.has('normalShop')?'Đang tải danh mục cửa hàng…':'Không có mặt hàng phù hợp bộ lọc hiện tại.');
    body.append(at(note(status,catalog?.queryError?'error':''),255,174,700,70));
  }
  body.append(nativeButton(ui,{skin:P+'public/button_window_blue.png',text:'Làm mới',label:'Làm mới cửa hàng',x:878,y:101,width:100,height:28,
    testId:'normal-shop-refresh',disabled:ui.loading.has('normalShop'),onClick:()=>ui.queryServer('normalShop','capi/normalshopquery.php',{},true)}));
  if(ui.snapshot.play?.phase!=='lobby'&&!ui.snapshot.normalShop?.pending)body.append(at(note('Về sảnh để mua hoặc mở vật phẩm.'),240,575,740,26));
  renderNormalShopRecovery(ui,body,{shop:true});
}
export function appendNormalShopBoxAction(ui,detail,item,container){
  const box=normalShopBox(ui,item.templateId);if(!box)return;
  detail.append(note(rulesText(box)));
  const protectedItem=item.lifeTime!==0||!Number.isInteger(item.extFlag)||(item.extFlag&~17)!==0;
  detail.append(flashSpriteButton(ui,'zh_CN/gui_summer/controls/public/button_2_green.png','Mở 1 '+(box.mode==='random'?'hộp':'gói quà'),()=>openNormalShopBox(ui,item,container),{
    width:136,height:30,testId:'inventory-open-box',disabled:!canUseNormalShop(ui)||protectedItem,
    title:protectedItem?'Vật phẩm đang khóa, có thời hạn hoặc đang sử dụng.':canUseNormalShop(ui)?'Xem trước phần thưởng rồi xác nhận mở.':blocker(ui)}));
}
function dialogIntent(value){
  if(value.mode==='topup')return canonicalShopIntent({kind:'topup',pack:value.pack});
  return canonicalShopIntent(value.mode==='buy'?{kind:'buy',goods_id:value.goods.goodsId,payment:value.payment,quantity:value.quantity}
    :{kind:'open_box',item:shopItemReference(value.item,value.container)});
}
function currentDialog(ui,value){return !ui.disposed&&ui.confirmation===value&&ui.epoch===value.epoch&&ui.identity===value.identity&&ui.client.generation===value.generation;}
async function runDialog(ui,value,action){
  if(!currentDialog(ui,value)||value.busy||!(action==='status'?canRecover(ui):canUseNormalShop(ui)))return;
  if(action==='preview'&&value.mode==='buy'&&(!whole(value.quantity,1,maxQuantity(value.goods))||!value.goods.payments.some(p=>p.key===value.payment))){
    value.notice='Nhập số lượt mua nguyên từ 1 đến '+numberText(maxQuantity(value.goods))+'.';ui.render();return;
  }
  if(action==='apply'&&!value.preview)return;
  value.busy=true;value.notice=action==='preview'?'Đang kiểm tra giá, số lượng và phần thưởng…':action==='apply'?'Đang chờ máy chủ xác nhận…':'Đang kiểm tra biên nhận đã lưu…';ui.render();
  try{
    const result=action==='preview'?await ui.client.prepareShop(dialogIntent(value)):action==='apply'?await ui.client.applyShop(value.preview):await ui.client.reconcileShop();
    if(!currentDialog(ui,value))return;
    if(!result)throw new Error('Phiên giao dịch đã thay đổi. Hãy mở lại cửa hàng.');
    ui.snapshot=ui.client.snapshot?.()||ui.snapshot;
    if(action==='preview'&&result.status!=='committed'){value.preview=result;value.stage='confirm';value.notice='';}
    else{
      value.preview=null;value.stage='done';value.notice=result.status==='committed'?shopReceiptText(result.receipt)
        :result.status==='none'?'Không có giao dịch đang chờ.':'Máy chủ xác nhận giao dịch trước chưa thực hiện. Bạn có thể đóng và chọn lại.';
      if(result.pendingClearFailed)value.notice+=' Chưa xóa được mã chờ trên trình duyệt; hãy kiểm tra kết quả trước khi mua tiếp.';
      ui.message=value.notice;ui.messageError=false;
    }
  }catch(error){if(currentDialog(ui,value)){value.preview=null;value.stage='choose';value.notice=error?.message||'Chưa xác nhận được giao dịch.';}}
  finally{if(currentDialog(ui,value)){value.busy=false;ui.snapshot=ui.client.snapshot?.()||ui.snapshot;ui.render();}}
}
function rewardList(rewards,title){
  const section=element('section',null,'m81345-shop-rewards');if(title)section.append(element('strong',title));
  const list=element('ul');for(const reward of rewards||[])list.append(element('li',rewardText(reward)));section.append(list);return section;
}
function boxDetails(parent,box){
  if(!box)return;
  parent.append(note(rulesText(box)));
  if(box.mode==='random'){
    parent.append(rewardList(box.main_rewards,'Phần thưởng chính · 10%'),rewardList(box.material_rewards,'Nguyên liệu ngẫu nhiên · 90%'),
      note('Nếu đã sở hữu phần thưởng chính duy nhất, máy chủ sẽ giữ nguyên hộp và báo trước khi mở.'));
  }else parent.append(rewardList(box.fixed_rewards,'Nội dung gói'));
}
export function renderNormalShopConfirmation(ui,value){
  const overlay=element('div',null,'m8-account-modal m81345-shop-overlay');overlay.dataset.testid='normal-shop-dialog';
  const current=()=>currentDialog(ui,value),cancel=()=>{if(!current()||value.busy)return;ui.confirmation=null;ui.render();};
  const {root,content}=createNativePanel({assets:ui.assets.panels.assets,width:650,height:530,kind:'box1',state:'CONFIRM'});
  root.classList.add('m81345-shop-confirm');root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Giao dịch cửa hàng');
  const topClose=flashCloseButton(ui,cancel,{label:'Đóng hộp thoại cửa hàng',className:'m81345-shop-close-x'});
  topClose.disabled=value.busy;
  root.append(topClose);
  const body=at(element('div',null,'m81345-shop-dialog-body'),28,48,594,412),pending=ui.snapshot.normalShop?.pending;
  const title=value.mode==='topup'?'Nạp Xu mô phỏng':value.mode==='buy'?'Mua '+nativeText(value.goods.name):value.mode==='open_box'?'Mở '+nativeText(normalShopBox(ui,value.item.templateId)?.name||'hộp quà'):'Kiểm tra giao dịch';
  body.append(element('h2',title));
  const footer=at(element('div',null,'m81345-shop-dialog-footer'),28,478,594,34);
  const button=(text,handler,id,disabled=false,primaryBtn=false)=>nativeButton(ui,{skin:primaryBtn?P+'public/button_window_orange.png':P+'public/button_window_blue.png',text,label:text,width:170,height:32,
    onClick:()=>{if(current()&&!value.busy)return handler();},testId:id,disabled:disabled||value.busy});
  let primary=null;
  if(pending){
    body.append(note('Giao dịch đã có mã đối soát. Kiểm tra kết quả để đồng bộ với máy chủ.'));
    if(pending.invalid)body.append(note('Không đọc được bản ghi cục bộ. Giữ nguyên dữ liệu trình duyệt để kiểm tra.','error'));
    primary=button('Kiểm tra kết quả',()=>runDialog(ui,value,'status'),'normal-shop-reconcile',!!pending.invalid||!canRecover(ui),true);
  }else if(value.stage!=='done'&&value.mode!=='recover'){
    if(value.mode==='topup'){
      const voucherBalance=ui.snapshot.meta.character.currency?.presentPoint||0;
      body.append(note('Đổi phiếu nhận từ trận PK cổ điển lấy Xu. Chỉ dùng tiền trong game.'),
        note(`Số dư: ${numberText(voucherBalance)} phiếu`));
      const pack=selectInput(value.packs.map(row=>({value:row.vouchers,
        label:`${numberText(row.vouchers)} phiếu → ${numberText(row.xu)} Xu`})),value.pack,'Gói mô phỏng');
      pack.dataset.testid='topup-pack';
      pack.disabled=value.busy||value.stage==='confirm';
      pack.addEventListener('change',()=>{value.pack=Number(pack.value);value.notice='';ui.render();});
      body.append(pack);
      if(value.preview?.quote)body.append(note(`Còn ${numberText(value.preview.quote.voucher_balance-value.pack)} phiếu sau khi đổi.`),
        rewardList(value.preview.quote.rewards,'Nhận sau khi đổi'));
      primary=value.stage==='confirm'
        ?button('Xác nhận đổi',()=>runDialog(ui,value,'apply'),'normal-shop-confirm',!canUseNormalShop(ui),true)
        :button('Xem trước',()=>runDialog(ui,value,'preview'),'normal-shop-preview',!canUseNormalShop(ui)||voucherBalance<value.pack,true);
      if(voucherBalance<value.pack)body.append(note('Hoàn thành trận PK cổ điển để nhận thêm phiếu.'));
    }else{
    const heroOffer=value.mode==='buy'?value.goods:normalShopOffer(ui,value.item.templateId),hero=element('div',null,'m81345-shop-hero');
    if(heroOffer){const image=normalShopVisual(ui,heroOffer,82,82);if(image)hero.append(image);}
    const info=element('div');
    if(value.mode==='buy')info.append(note(nativeText(value.goods.description||'')));
    else info.append(note(`Mở đúng 1 hộp. Hiện có ${numberText(value.item.count)}.`));
    hero.append(info);body.append(hero);
    if(value.mode==='buy'){
      const choices=element('div',null,'m81345-shop-choices'),payment=value.goods.payments.find(p=>p.key===value.payment)||value.goods.payments[0];
      const quantity=element('input');quantity.type='number';quantity.min='1';quantity.max=String(maxQuantity(value.goods));quantity.step='1';quantity.value=String(value.quantity);
      quantity.dataset.accountField='normal-shop-quantity';quantity.dataset.testid='normal-shop-quantity';quantity.setAttribute('aria-label','Số lượt mua');quantity.disabled=value.busy||value.stage==='confirm';
      quantity.addEventListener('input',()=>{if(!current()||value.busy||value.stage==='confirm')return;value.quantity=Number(quantity.value);value.preview=null;ui.render();});
      const quantityLabel=element('label','Số lượt mua ');quantityLabel.append(quantity);
      const paymentSelect=selectInput(value.goods.payments.map(p=>({value:p.key,label:`${numberText(p.price)} ${shopCurrencyName(p.coinType)} / ${numberText(p.quantity)} vật phẩm`})),value.payment,'Cách thanh toán');
      paymentSelect.dataset.testid='normal-shop-payment';paymentSelect.dataset.accountField='normal-shop-payment';paymentSelect.disabled=value.busy||value.stage==='confirm';
      paymentSelect.addEventListener('change',()=>{if(!current()||value.busy||value.stage==='confirm')return;value.payment=paymentSelect.value;value.preview=null;ui.render();});
      choices.append(quantityLabel,paymentSelect);body.append(choices);
      const balance=Number(ui.snapshot.meta?.character?.currency?.[currencyField(payment.coinType)]||0),quantityValid=whole(value.quantity,1,maxQuantity(value.goods));
      body.append(note(quantityValid?`Tổng: ${numberText(payment.price*value.quantity)} ${shopCurrencyName(payment.coinType)} · Nhận ${numberText(payment.quantity*value.quantity)} đơn vị. Số dư: ${numberText(balance)} ${shopCurrencyName(payment.coinType)}.`:'Nhập số lượt mua hợp lệ.'));
    }
    const details=element('div',null,'m81345-shop-dialog-details'),quote=value.preview?.quote;
    if(quote?.kind==='buy'){
      details.append(note(`Máy chủ xác nhận: ${numberText(quote.total_price)} ${shopCurrencyName(quote.coin_type)}.`),rewardList(quote.rewards,'Nhận sau khi mua'));
      boxDetails(details,normalShopBox(ui,value.goods.boxId||value.goods.itemId));
    }else if(quote?.kind==='open_box')boxDetails(details,quote.box);
    else boxDetails(details,normalShopBox(ui,value.mode==='buy'?value.goods.boxId||value.goods.itemId:value.item.templateId));
    if(value.mode==='buy'&&normalShopBox(ui,value.goods.boxId||value.goods.itemId))details.append(note(value.goods.autoUse?'Nội dung gói được nhận ngay khi mua.':'Sau khi mua, vào Kho để chọn mở.'));
    body.append(details);
    if(value.stage==='confirm'){
      primary=button(value.mode==='buy'?'Xác nhận mua':'Xác nhận mở 1',()=>runDialog(ui,value,'apply'),'normal-shop-confirm',!canUseNormalShop(ui),true);
      footer.append(button('Chọn lại',()=>{value.stage='choose';value.preview=null;value.notice='';ui.render();},'normal-shop-back'));
    }else primary=button('Xem trước',()=>runDialog(ui,value,'preview'),'normal-shop-preview',!canUseNormalShop(ui),true);
    }
    if(!canUseNormalShop(ui)&&!value.busy)body.append(note(blocker(ui),'error'));
  }else if(value.mode==='recover'&&value.stage!=='done')body.append(note('Không có giao dịch đang chờ.'));
  if(value.notice){const status=note(value.notice);status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.classList.add('m81345-shop-dialog-status');body.append(status);}
  const close=button(value.stage==='done'?'Đóng':'Hủy',cancel,'normal-shop-cancel');if(primary)footer.append(primary);footer.append(close);
  content.append(body,footer);overlay.append(root);overlay.initialFocus=close;
  overlay.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancel();}
    if(event.key==='Tab'){const nodes=[...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      if(!nodes.length)return;event.preventDefault();const index=nodes.indexOf(document.activeElement);nodes[(index+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}});
  return overlay;
}
