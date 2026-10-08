const $ = s => document.querySelector(s);
const rupiah = n => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n));
let products=[], cart=JSON.parse(localStorage.getItem("khelz_cart")||"[]"), token=localStorage.getItem("khelz_token")||"";
let authMode="login", activeGame="all";

function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2400)}
function save(){localStorage.setItem("khelz_cart",JSON.stringify(cart));renderCart()}
function openModal(id){$("#"+id).classList.add("show")}
function closeModal(id){$("#"+id).classList.remove("show")}
function openCart(){renderCart();openModal("cartModal")}
function openLogin(){openModal("loginModal")}
function fmtStatus(s){return ({pending_payment:"Menunggu Pembayaran",processing:"Diproses",completed:"Selesai",cancelled:"Dibatalkan"})[s]||s}

async function api(url,opts={}){
  opts.headers={...(opts.headers||{}),...(token?{Authorization:"Bearer "+token}:{})};
  const r=await fetch(url,opts); const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Terjadi kesalahan");
  return data;
}

async function load(){
  products=await api("/api/products");
  renderFilters();renderProducts();renderCart();
}
function renderFilters(){
  const games=[["all","Semua"],...Array.from(new Map(products.map(p=>[p.game,p.game])).entries())];
  $("#filters").innerHTML=games.map(([id,label])=>`<button class="chip ${activeGame===id?"active":""}" onclick="activeGame='${id}';renderFilters();renderProducts()">${label}</button>`).join("");
}
function renderProducts(){
  const list=activeGame==="all"?products:products.filter(p=>p.game===activeGame);
  $("#count").textContent=list.length+" produk";
  $("#products").innerHTML=list.map(p=>`<article class="product">
    <div class="icon">${p.icon||"🎮"}</div><h3>${esc(p.name)}</h3>
    <div class="price">${rupiah(p.price)}</div>
    <div class="stock ${p.stock>0?"ok":"empty"}">${p.stock>0?"Stok tersedia: "+p.stock:"Stok habis"}</div>
    <button class="primary" ${p.stock<1?"disabled":""} onclick="add(${p.id})">${p.stock>0?"Tambah":"Habis"}</button>
  </article>`).join("")||`<div class="notice">Belum ada produk.</div>`;
}
function add(id){const p=products.find(x=>x.id==id);const old=cart.find(x=>x.productId==id);if(old)old.quantity++;else cart.push({productId:id,quantity:1});save();toast(p.name+" ditambahkan");}
function renderCart(){
  $("#cartCount").textContent=cart.reduce((a,b)=>a+b.quantity,0);
  let total=0;
  $("#cartItems").innerHTML=cart.map((x,i)=>{const p=products.find(p=>p.id==x.productId);if(!p)return "";total+=p.price*x.quantity;return `<div class="cartrow"><div><b>${esc(p.name)}</b><div class="muted">${rupiah(p.price)} × ${x.quantity}</div></div><div><b>${rupiah(p.price*x.quantity)}</b><br><button class="ghost" onclick="removeItem(${i})">Hapus</button></div></div>`}).join("")||`<div class="notice">Keranjang masih kosong.</div>`;
  $("#cartTotal").textContent=rupiah(total);
}
function removeItem(i){cart.splice(i,1);save()}
function openCheckout(){if(!cart.length)return toast("Keranjang kosong");closeModal("cartModal");if(!token){toast("Silakan login terlebih dahulu");return openLogin()}openModal("checkoutModal")}

async function submitOrder(){
  try{
    const items=cart;
    const data=await api("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
      items,customerName:$("#custName").value.trim(),customerWa:$("#custWa").value.trim(),
      gameId:$("#gameId").value.trim(),serverId:$("#serverId").value.trim(),note:$("#note").value.trim()
    })});
    cart=[];save();closeModal("checkoutModal");$("#orderCode").value=data.orderId;await checkOrder();
    window.location.href=data.redirect_url;
  }catch(e){toast(e.message)}
}
async function checkOrder(){
  const code=$("#orderCode").value.trim();if(!code)return toast("Masukkan kode order");
  try{const o=await api("/api/orders/"+encodeURIComponent(code));$("#orderResult").innerHTML=`<b>${o.id}</b><br>Total: ${rupiah(o.total)}<br>Status: <b>${fmtStatus(o.status)}</b><br>Pembayaran: <b>${o.payment_status}</b>`}
  catch(e){$("#orderResult").textContent=e.message}
}
function toggleAuth(){authMode=authMode==="login"?"register":"login";$("#loginTitle").textContent=authMode==="login"?"Login":"Daftar";$("#registerOnly").style.display=authMode==="register"?"block":"none";$("#authMsg").textContent=""}
async function submitAuth(){
  try{
    const data=await api(authMode==="login"?"/api/auth/login":"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:$("#loginEmail").value,password:$("#loginPassword").value})});
    token=data.token;localStorage.setItem("khelz_token",token);closeModal("loginModal");toast("Login berhasil");
    if(data.user?.role==="admin") setTimeout(()=>location.href="/admin.html",300);
  }catch(e){$("#authMsg").textContent=e.message}
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
window.addEventListener("click",e=>{if(e.target.classList.contains("modal"))e.target.classList.remove("show")});
load().catch(e=>toast(e.message));