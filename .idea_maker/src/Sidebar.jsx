// Persistent left rail: brand, project switcher, nav, footer user.
const sidebarStyles = {
  rail: {
    width: 248, flex:"none", height:"100%",
    background:"var(--bg-rail)",
    color:"var(--ink)",
    display:"flex",flexDirection:"column",
    borderRight:"1px solid var(--line-strong)",
  },
  brand: {
    display:"flex",alignItems:"center",gap:10, padding:"18px 18px 14px",
  },
  brandMark: {
    width:30,height:30,borderRadius:8,
    background:"linear-gradient(135deg, #6BBFAF 0%, #3D8C7F 100%)",
    display:"flex",alignItems:"center",justifyContent:"center",
    fontFamily:"'Inter Tight', sans-serif",fontWeight:700,color:"#fff",fontSize:14,
    boxShadow:"0 0 0 1px rgba(255,255,255,.4) inset, 0 4px 10px rgba(79,168,154,.28)",
    letterSpacing:"-.02em",
  },
  brandText: { fontFamily:"'Inter Tight', sans-serif", fontWeight:600, fontSize:15,
               letterSpacing:"-.01em", color:"var(--ink)" },
  brandTag:  { fontSize:10.5, color:"var(--ink-3)", marginTop:1, letterSpacing:".02em" },

  switcher: {
    margin:"4px 12px 14px", padding:"10px 10px",
    background:"#fff",
    border:"1px solid var(--line)",
    borderRadius:10, display:"flex",alignItems:"center",gap:10, cursor:"default",
    boxShadow:"0 1px 2px rgba(31,45,52,.03)",
  },

  sectionLbl: {
    padding:"10px 18px 6px", fontSize:10.5, letterSpacing:".1em",
    color:"var(--ink-4)", textTransform:"uppercase", fontWeight:600,
  },

  navItem: (active) => ({
    display:"flex",alignItems:"center",gap:11,
    margin:"1px 10px", padding:"8px 11px",
    borderRadius:8, fontSize:13, fontWeight: active ? 600 : 500,
    color: active ? "var(--brand-ink)" : "var(--ink-2)",
    background: active ? "var(--brand-soft)" : "transparent",
    cursor:"default", transition:".15s",
    border: active ? "1px solid rgba(79,168,154,.22)" : "1px solid transparent",
  }),

  badge: {
    marginLeft:"auto", minWidth:18, padding:"0 6px", height:18,
    borderRadius:9, background:"rgba(31,45,52,.06)", color:"var(--ink-3)",
    fontSize:10.5, fontWeight:600, fontFamily:"'JetBrains Mono', monospace",
    display:"inline-flex",alignItems:"center",justifyContent:"center",
  },

  footer: {
    marginTop:"auto", padding:"10px 12px 14px",
    borderTop:"1px solid var(--line)",
  },
  user: {
    display:"flex",alignItems:"center",gap:10, padding:"8px 10px", borderRadius:9,
    background:"#fff", border:"1px solid var(--line)",
  },
  avatar: {
    width:28,height:28,borderRadius:"50%",
    background:"linear-gradient(135deg, #F0B86E, #DA8A4A)",
    color:"#fff", fontWeight:600,fontSize:12,
    display:"flex",alignItems:"center",justifyContent:"center",
    fontFamily:"'Inter Tight', sans-serif",
  },
  costRow: {
    margin:"10px 6px 0", padding:"8px 10px",
    background:"var(--brand-soft)",
    border:"1px solid rgba(79,168,154,.2)",
    borderRadius:8, fontSize:11.5, color:"var(--brand-ink)",
    display:"flex",alignItems:"center",justifyContent:"space-between",
  },
};

function Sidebar({ route, setRoute, project, setProject, openProjectMenu, setOpenProjectMenu }) {
  const items = [
    { id:"chat",     label:"对话",     icon:<IconMessage size={16} /> , badge:"新" },
    { id:"upload",   label:"知识库",   icon:<IconUpload  size={16} /> , badge: project.docs },
    { id:"history",  label:"内容资产", icon:<IconClock   size={16} /> , badge: 23 },
    { id:"settings", label:"项目设置", icon:<IconCog     size={16} /> },
  ];
  return (
    <aside style={sidebarStyles.rail}>
      <div style={sidebarStyles.brand}>
        <div style={sidebarStyles.brandMark}>H</div>
        <div>
          <div style={sidebarStyles.brandText}>Harness</div>
          <div style={sidebarStyles.brandTag}>透明 · 可观测 · 懂你的 Agent</div>
        </div>
      </div>

      {/* Project switcher */}
      <div
        style={{...sidebarStyles.switcher, cursor:"pointer"}}
        onClick={() => setOpenProjectMenu(!openProjectMenu)}
      >
        <div style={{
          width:28,height:28,borderRadius:7,
          background:"var(--brand-soft)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,
        }}>{project.emoji}</div>
        <div style={{minWidth:0, flex:1}}>
          <div style={{fontSize:12.5, fontWeight:600, color:"var(--ink)",
                       whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{project.name}</div>
          <div style={{fontSize:10.5, color:"var(--ink-3)", marginTop:1}}>
            {project.docs} 文档 · 更新于 {project.updated}
          </div>
        </div>
        <IconDown size={14} stroke={1.8} style={{color:"var(--ink-3)"}} />

        {openProjectMenu && (
          <div onClick={(e)=>e.stopPropagation()} style={{
            position:"absolute", left:12, top:104, width: 224, zIndex:20,
            background:"#fff", border:"1px solid var(--line)",
            borderRadius:10, padding:6, boxShadow:"var(--shadow-lg)"
          }}>
            <div style={{fontSize:10.5,color:"var(--ink-4)",padding:"6px 10px 4px",
                         letterSpacing:".08em", textTransform:"uppercase", fontWeight:600}}>
              切换项目
            </div>
            {PROJECTS.map(p => (
              <div key={p.id}
                   onClick={() => { setProject(p); setOpenProjectMenu(false); }}
                   style={{
                     display:"flex", alignItems:"center",gap:10, padding:"7px 8px",
                     borderRadius:6, cursor:"pointer",
                     background: p.id === project.id ? "var(--brand-soft)" : "transparent",
                     color: p.id === project.id ? "var(--brand-ink)" : "var(--ink)",
                     fontSize:12.5,
                   }}
                   onMouseEnter={(e)=>{ if(p.id!==project.id) e.currentTarget.style.background="var(--bg-tint)"}}
                   onMouseLeave={(e)=>{ if(p.id!==project.id) e.currentTarget.style.background="transparent"}}
              >
                <div style={{width:22,height:22,borderRadius:5,background:"var(--bg)",
                             display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>{p.emoji}</div>
                <div style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                {p.id===project.id && <IconCheck size={13} stroke={2} style={{color:"var(--brand)"}}/>}
              </div>
            ))}
            <div onClick={() => { setRoute("projects"); setOpenProjectMenu(false); }}
                 style={{
                   marginTop:4, padding:"7px 8px", borderRadius:6, cursor:"pointer",
                   color:"var(--ink-3)", fontSize:12, display:"flex",alignItems:"center",gap:8,
                   borderTop:"1px solid var(--line-2)",
                 }}>
              <IconFolder size={13} /> 管理所有项目
            </div>
          </div>
        )}
      </div>

      <div style={sidebarStyles.sectionLbl}>当前项目</div>
      <div style={{display:"flex", flexDirection:"column", gap:1}}>
        {items.map(it => (
          <div key={it.id} style={sidebarStyles.navItem(route===it.id)}
               onClick={() => setRoute(it.id)}>
            <span style={{opacity:.85}}>{it.icon}</span>
            <span>{it.label}</span>
            {it.badge != null && (
              <span style={{
                ...sidebarStyles.badge,
                background: it.id==="chat" && route!==it.id ? "rgba(79,168,154,.16)" : sidebarStyles.badge.background,
                color:      it.id==="chat" && route!==it.id ? "var(--brand-2)" : sidebarStyles.badge.color,
              }}>{it.badge}</span>
            )}
          </div>
        ))}
      </div>

      <div style={{...sidebarStyles.sectionLbl, marginTop: 14}}>工作区</div>
      <div style={{display:"flex", flexDirection:"column", gap:1}}>
        <div style={sidebarStyles.navItem(route==="projects")} onClick={() => setRoute("projects")}>
          <span style={{opacity:.85}}><IconFolder size={16} /></span>
          <span>所有项目</span>
          <span style={sidebarStyles.badge}>{PROJECTS.length}</span>
        </div>
      </div>

      <div style={sidebarStyles.footer}>
        <div style={sidebarStyles.costRow}>
          <span style={{display:"flex",alignItems:"center",gap:6}}>
            <IconDollar size={12} stroke={2} />
            本周
          </span>
          <span className="mono" style={{color:"var(--brand-ink)",fontWeight:700}}>${project.cost.toFixed(2)}</span>
        </div>
        <div style={{...sidebarStyles.user, marginTop:10}}>
          <div style={sidebarStyles.avatar}>YQ</div>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:12.5,fontWeight:600,color:"var(--ink)"}}>叶清</div>
            <div style={{fontSize:10.5,color:"var(--ink-3)"}}>Pro · 7 天试用</div>
          </div>
          <IconCog size={14} style={{opacity:.5, color:"var(--ink-3)"}} />
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { Sidebar });
