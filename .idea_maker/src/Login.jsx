function Login({ onSignIn }) {
  const [mode, setMode] = React.useState("signin");
  const [email, setEmail] = React.useState("yeqing@example.com");
  const [pw, setPw] = React.useState("••••••••");

  const input = {
    width:"100%", height:42, padding:"0 14px", borderRadius:9,
    border:"1px solid var(--line-strong)", outline:"none", fontSize:14,
    background:"#fff",
  };

  return (
    <main style={{
      position:"absolute", inset:0, display:"flex", background:"var(--bg)",
    }}>
      {/* Left brand panel */}
      <div style={{
        flex:"1 1 56%", position:"relative", overflow:"hidden",
        background:"linear-gradient(135deg, #3D8C7F 0%, #4FA89A 45%, #6BC0A8 100%)",
        color:"#fff", padding:"42px 50px", display:"flex", flexDirection:"column",
      }}>
        {/* Decorative orbital lines */}
        <svg viewBox="0 0 600 600" style={{
          position:"absolute", right:-120, top:-80, width:740, opacity:.18,
        }}>
          <defs>
            <radialGradient id="rg" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFF1B8" stopOpacity=".7" />
              <stop offset="100%" stopColor="#FFF1B8" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="300" cy="300" r="100" fill="url(#rg)" />
          {[140,200,260,320,380].map((r,i) => (
            <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="#fff"
                    strokeWidth=".8" strokeDasharray={i%2?"6 4":"0"} opacity=".55" />
          ))}
          <circle cx="180" cy="300" r="4" fill="#FFF1B8" />
          <circle cx="420" cy="240" r="5" fill="#C2EAE0" />
          <circle cx="380" cy="420" r="3" fill="#fff" />
        </svg>

        <div style={{display:"flex",alignItems:"center", gap:12, position:"relative"}}>
          <div style={{
            width:38,height:38,borderRadius:10,
            background:"linear-gradient(135deg, #6BBFAF 0%, #3D8C7F 100%)",
            display:"flex",alignItems:"center",justifyContent:"center",
            fontFamily:"'Inter Tight', sans-serif",fontWeight:700,color:"#fff",fontSize:18,
            boxShadow:"0 0 0 1px rgba(255,255,255,.32) inset, 0 8px 18px rgba(0,0,0,.18)",
          }}>H</div>
          <div style={{fontFamily:"'Inter Tight', sans-serif", fontWeight:600, fontSize:19, letterSpacing:"-.01em"}}>
            Harness
          </div>
        </div>

        <div style={{flex:1, display:"flex", flexDirection:"column", justifyContent:"center",
                     position:"relative", marginTop:30}}>
          <div style={{fontSize:42, fontWeight:700, lineHeight:1.15, letterSpacing:"-.02em",
                       maxWidth:520, marginBottom:18}}>
            透明的 AI，
            <br />
            <span style={{
              background:"linear-gradient(90deg, #FFF1B8, #FFFEE8)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
            }}>懂你的 Agent</span>。
          </div>
          <div style={{fontSize:15, lineHeight:1.7, opacity:.78, maxWidth:480, marginBottom:34}}>
            不再是黑盒。Harness 让你看到 Agent 的每一次思考、每一次检索、每一次工具调用，
            并通过你的反馈逐步学习偏好。
          </div>

          {/* Differentiation row */}
          <div style={{display:"flex", gap:10}}>
            {[
              {icon:<IconBrain size={16} stroke={1.6} />, label:"4 阶段可视化", c:"#C2EAE0"},
              {icon:<IconSearch size={16} stroke={1.6} />, label:"来源可追溯",   c:"#A8E0DF"},
              {icon:<IconDollar size={16} stroke={1.6} />, label:"成本透明",     c:"#FFF1B8"},
            ].map((d, i) => (
              <div key={i} style={{
                padding:"10px 14px", borderRadius:10,
                background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.08)",
                display:"flex",alignItems:"center", gap:8, fontSize:12.5,
                backdropFilter:"blur(8px)",
              }}>
                <span style={{color:d.c}}>{d.icon}</span>
                {d.label}
              </div>
            ))}
          </div>
        </div>

        <div style={{position:"relative", fontSize:11.5, opacity:.5}}>
          © 2025 Harness Inc · 仅供原型演示
        </div>
      </div>

      {/* Right form */}
      <div style={{
        flex:"1 1 44%", display:"flex",alignItems:"center", justifyContent:"center", padding:"42px",
      }}>
        <div style={{width:"100%", maxWidth:380}}>
          <div style={{fontSize:24, fontWeight:600, letterSpacing:"-.01em", marginBottom:6}}>
            {mode==="signin" ? "欢迎回来" : "创建账户"}
          </div>
          <div style={{fontSize:13, color:"var(--ink-3)", marginBottom:24}}>
            {mode==="signin" ? "登录以继续使用 Harness" : "30 秒注册，免费试用 7 天"}
          </div>

          <div style={{display:"flex",flexDirection:"column", gap:12}}>
            {mode==="signup" && (
              <div>
                <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)", marginBottom:6}}>姓名</div>
                <input style={input} placeholder="你的名字" />
              </div>
            )}
            <div>
              <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)", marginBottom:6}}>邮箱</div>
              <input style={input} value={email} onChange={e=>setEmail(e.target.value)} />
            </div>
            <div>
              <div style={{display:"flex",justifyContent:"space-between", marginBottom:6}}>
                <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)"}}>密码</div>
                {mode==="signin" && <a style={{fontSize:11.5, color:"var(--brand)", textDecoration:"none"}}>忘记密码？</a>}
              </div>
              <input type="password" style={input} value={pw} onChange={e=>setPw(e.target.value)} />
            </div>
          </div>

          <button onClick={onSignIn}
                  className="btn btn-primary"
                  style={{width:"100%", height:42, marginTop:18, fontSize:14, fontWeight:600,
                          justifyContent:"center", borderRadius:10}}>
            {mode==="signin" ? "登录" : "创建账户"}
          </button>

          <div style={{
            display:"flex",alignItems:"center", gap:10, margin:"20px 0",
            color:"var(--ink-4)", fontSize:11.5,
          }}>
            <div style={{flex:1, height:1, background:"var(--line-2)"}} />
            或继续使用
            <div style={{flex:1, height:1, background:"var(--line-2)"}} />
          </div>

          <div style={{display:"flex", gap:8}}>
            <button className="btn" style={{flex:1, justifyContent:"center", height:38}}>
              <span style={{fontSize:13, fontWeight:600}}>Google</span>
            </button>
            <button className="btn" style={{flex:1, justifyContent:"center", height:38}}>
              <span style={{fontSize:13, fontWeight:600}}>GitHub</span>
            </button>
          </div>

          <div style={{marginTop:24, textAlign:"center", fontSize:13, color:"var(--ink-3)"}}>
            {mode==="signin" ? <>还没有账号？ <a onClick={()=>setMode("signup")} style={{color:"var(--brand)",cursor:"pointer",fontWeight:600}}>注册</a></>
                              : <>已有账号？ <a onClick={()=>setMode("signin")} style={{color:"var(--brand)",cursor:"pointer",fontWeight:600}}>登录</a></>}
          </div>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { Login });
