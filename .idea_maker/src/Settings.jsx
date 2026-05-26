function Settings({ project }) {
  const [provider, setProvider] = React.useState("Claude");
  const [model,    setModel]    = React.useState("claude-3-7-sonnet");
  const [temp,     setTemp]     = React.useState(0.7);
  const [maxTok,   setMaxTok]   = React.useState(2000);
  const [depth,    setDepth]    = React.useState("中等");
  const [retr,     setRetr]     = React.useState("自动");
  const [showKey,  setShowKey]  = React.useState(false);
  const [tested,   setTested]   = React.useState(false);
  const [saved,    setSaved]    = React.useState(false);

  const Field = ({ label, hint, children, span=1 }) => (
    <div style={{gridColumn:`span ${span}`}}>
      <div style={{fontSize:12, fontWeight:600, color:"var(--ink-2)", marginBottom:5}}>{label}</div>
      {children}
      {hint && <div style={{fontSize:11.5, color:"var(--ink-4)", marginTop:5}}>{hint}</div>}
    </div>
  );

  const Section = ({ icon, title, sub, children }) => (
    <div className="card" style={{padding:"18px 20px", marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center", gap:10, marginBottom:14, paddingBottom:12,
                   borderBottom:"1px solid var(--line-2)"}}>
        <span style={{
          width:30,height:30,borderRadius:8, background:"var(--brand-soft)", color:"var(--brand)",
          display:"flex",alignItems:"center",justifyContent:"center",
        }}>{icon}</span>
        <div style={{flex:1}}>
          <div style={{fontSize:14, fontWeight:600}}>{title}</div>
          <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:1}}>{sub}</div>
        </div>
      </div>
      {children}
    </div>
  );

  const input = {
    width:"100%", height:34, padding:"0 11px", borderRadius:7,
    border:"1px solid var(--line-strong)", outline:"none", fontSize:13, background:"#fff",
  };

  const Select = ({ value, onChange, options }) => (
    <div style={{position:"relative"}}>
      <select value={value} onChange={e=>onChange(e.target.value)}
              style={{...input, appearance:"none", paddingRight:30, cursor:"pointer"}}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <IconDown size={12} style={{position:"absolute", right:10, top:11, color:"var(--ink-3)",
                                  pointerEvents:"none"}} />
    </div>
  );

  return (
    <main style={{flex:1,height:"100%",overflow:"auto", background:"var(--bg)"}}>
      <div style={{maxWidth:880, margin:"0 auto", padding:"28px 32px 80px"}}>
        <div style={{marginBottom:18}}>
          <div style={{fontSize:22, fontWeight:600, letterSpacing:"-.01em"}}>⚙️ 项目设置 · {project.name}</div>
          <div style={{fontSize:13, color:"var(--ink-3)", marginTop:2}}>
            模型、检索、成本与权限 · 所有设置仅对当前项目生效
          </div>
        </div>

        <Section icon={<IconLock size={14} stroke={1.8} />} title="API 配置" sub="LLM 提供商和密钥">
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:14}}>
            <Field label="LLM 提供商">
              <Select value={provider} onChange={setProvider} options={["Claude","OpenAI","Gemini","Qwen"]} />
            </Field>
            <Field label="API Key" hint="密钥仅保存在本地浏览器，不会同步到服务器">
              <div style={{position:"relative"}}>
                <input type={showKey?"text":"password"} defaultValue="sk-ant-aaaa-1234-5678"
                       style={input} />
                <button onClick={()=>setShowKey(v=>!v)}
                  style={{position:"absolute", right:6, top:5, width:24, height:24, border:"none",
                          background:"transparent", cursor:"pointer", color:"var(--ink-3)"}}>
                  <IconEye size={13} stroke={1.8} />
                </button>
              </div>
            </Field>
            <div style={{gridColumn:"span 2", display:"flex", gap:8, alignItems:"center"}}>
              <button className="btn btn-sm" onClick={()=>{setTested(true); setTimeout(()=>setTested(false), 2500);}}>
                <IconBolt size={12} stroke={1.8} /> 测试连接
              </button>
              {tested && <span className="chip fade-in" style={{
                background:"rgba(31,138,91,.08)", color:"var(--ok)",
              }}><IconCheck size={11} stroke={2.4} /> 连接成功 · 延迟 142ms</span>}
            </div>
          </div>
        </Section>

        <Section icon={<IconSparkle size={14} stroke={1.8} />} title="生成模型设置" sub="主生成模型与生成参数">
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:14}}>
            <Field label="主生成模型">
              <Select value={model} onChange={setModel}
                      options={["claude-3-7-sonnet","claude-haiku-4-5","gpt-4o","gpt-4o-mini","gemini-2.5-pro"]} />
            </Field>
            <Field label="思考深度" hint="影响 Agent 自我迭代次数（1–5）">
              <Select value={depth} onChange={setDepth} options={["快速","中等","深度","深度+"]} />
            </Field>
            <Field label={
              <span style={{display:"flex",justifyContent:"space-between",width:"100%"}}>
                <span>温度 (Temperature)</span>
                <span className="mono" style={{color:"var(--brand)", fontWeight:700}}>{temp.toFixed(1)}</span>
              </span>
            } hint="越高越有创意，越低越稳定">
              <input type="range" min={0} max={1} step={.1} value={temp}
                     onChange={e=>setTemp(parseFloat(e.target.value))}
                     style={{width:"100%", accentColor:"var(--brand)"}} />
              <div style={{display:"flex",justifyContent:"space-between", fontSize:10.5,
                           color:"var(--ink-4)", marginTop:2}} className="mono">
                <span>0.0 严谨</span><span>0.5</span><span>1.0 发散</span>
              </div>
            </Field>
            <Field label="最大 tokens" hint="单次生成的最大长度">
              <input type="number" value={maxTok} onChange={e=>setMaxTok(parseInt(e.target.value)||0)}
                     style={input} className="mono" />
            </Field>
          </div>
        </Section>

        <Section icon={<IconSearch size={14} stroke={1.8} />} title="向量与检索" sub="知识库检索策略">
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:14}}>
            <Field label="Embedding 模型" hint="自动选择最优模型，无需配置">
              <Select value="自动 (text-embedding-3-large)" onChange={()=>{}} options={["自动 (text-embedding-3-large)","bge-large-zh","gte-large"]} />
            </Field>
            <Field label="检索模式">
              <div style={{display:"flex", gap:6}}>
                {["自动","手动"].map(m => (
                  <button key={m} onClick={()=>setRetr(m)}
                    className="btn btn-sm"
                    style={{
                      flex:1, justifyContent:"center",
                      background: retr===m ? "var(--brand)" : "#fff",
                      color: retr===m ? "#fff" : "var(--ink-2)",
                      borderColor: retr===m ? "var(--brand)" : "var(--line-strong)",
                    }}>
                    {retr===m && <IconCheck size={11} stroke={2.4} />}
                    {m}{m==="自动" && " (推荐)"}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Section>

        <Section icon={<IconDollar size={14} stroke={1.8} />} title="成本与统计" sub="用量、限额与报表">
          <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:12}}>
            {[
              { label:"本周成本",   v:`$${project.cost.toFixed(2)}`, sub:"较上周 ↓ 12%", color:"var(--ok)" },
              { label:"本月成本",   v:"$48.20",                       sub:"剩余预算 $51.80", color:"var(--ink)" },
              { label:"平均单次",   v:"$0.17",                        sub:"行业基准 $0.34", color:"var(--brand)" },
            ].map((s, i) => (
              <div key={i} style={{
                padding:"12px 14px", borderRadius:9, background:"#FBF9F2",
                border:"1px solid var(--line-2)",
              }}>
                <div style={{fontSize:11.5, color:"var(--ink-3)", marginBottom:4, fontWeight:500}}>{s.label}</div>
                <div className="mono" style={{fontSize:22, fontWeight:700, color:s.color, letterSpacing:"-.02em"}}>{s.v}</div>
                <div style={{fontSize:11, color:"var(--ink-4)", marginTop:3}}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:14, padding:"12px 14px", borderRadius:9, background:"rgba(180,83,9,.06)",
                       border:"1px solid rgba(180,83,9,.18)", display:"flex",alignItems:"center", gap:12}}>
            <span style={{
              width:28,height:28,borderRadius:7, background:"var(--warn)", color:"#fff",
              display:"flex",alignItems:"center",justifyContent:"center", fontSize:14, fontWeight:700,
            }}>!</span>
            <div style={{flex:1}}>
              <div style={{fontSize:13, fontWeight:600}}>未设置每日成本上限</div>
              <div style={{fontSize:11.5, color:"var(--ink-3)", marginTop:2}}>
                推荐设置 $5 / 天的软上限，超限时 Agent 会切换到更便宜的 Haiku 模型继续工作
              </div>
            </div>
            <button className="btn btn-sm">设置每日限制</button>
          </div>
        </Section>

        <div style={{display:"flex", gap:8, marginTop:18}}>
          <button className="btn btn-primary" onClick={()=>{setSaved(true); setTimeout(()=>setSaved(false), 2000);}}>
            {saved ? <><IconCheck size={12} stroke={2.4} /> 已保存</> : "保存设置"}
          </button>
          <button className="btn">重置</button>
          <button className="btn btn-ghost"><IconDownload size={12} stroke={1.8} /> 导出设置</button>
          <span style={{flex:1}} />
          <button className="btn btn-ghost" style={{color:"var(--err)"}}>
            <IconTrash size={12} stroke={1.8} /> 删除项目
          </button>
        </div>
      </div>
    </main>
  );
}

Object.assign(window, { Settings });
