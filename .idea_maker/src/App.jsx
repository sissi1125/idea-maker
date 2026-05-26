// Top-level App. Owns route + project + auth state. Mounts Tweaks panel.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#4FA89A",
  "density": "regular",
  "showThinkingByDefault": true,
  "showStarterScreen": false
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute]       = React.useState("chat");
  const [project, setProject]   = React.useState(PROJECTS[0]);
  const [signedIn, setSignedIn] = React.useState(!t.showStarterScreen);
  const [openMenu, setOpenMenu] = React.useState(false);

  // Apply accent live
  React.useEffect(() => {
    if (t.accent) {
      document.documentElement.style.setProperty("--brand", t.accent);
      // Derive softer variants
      document.documentElement.style.setProperty("--brand-soft",
        t.accent === "#4FA89A" ? "#E4F1ED" :
        t.accent === "#5B8DD6" ? "#E8F0FA" :
        t.accent === "#9A7AC8" ? "#EFE8F8" :
        t.accent === "#D6A24B" ? "#F8EFD6" : "#E4F1ED"
      );
    }
  }, [t.accent]);

  // When tweak flips showStarterScreen we honor it
  React.useEffect(() => {
    if (t.showStarterScreen) setSignedIn(false);
  }, [t.showStarterScreen]);

  if (!signedIn) {
    return (
      <>
        <Login onSignIn={() => { setSignedIn(true); setRoute("chat"); }} />
        <TweakPanel t={t} setTweak={setTweak} />
      </>
    );
  }

  // Close project menu when clicking outside
  React.useEffect(() => {
    if (!openMenu) return;
    const h = () => setOpenMenu(false);
    setTimeout(() => window.addEventListener("click", h, { once:true }), 50);
    return () => window.removeEventListener("click", h);
  }, [openMenu]);

  let main;
  if      (route === "chat")     main = <Chat     project={project} />;
  else if (route === "projects") main = <Projects project={project} setProject={setProject} setRoute={setRoute} />;
  else if (route === "upload")   main = <Upload   project={project} setRoute={setRoute} />;
  else if (route === "history")  main = <History  project={project} />;
  else if (route === "settings") main = <Settings project={project} />;

  return (
    <>
      <div style={{display:"flex", height:"100%"}}
           data-screen-label={({
             chat:"01 主对话", projects:"02 项目管理", upload:"03 知识库上传",
             history:"04 内容资产", settings:"05 项目设置",
           })[route]}>
        <Sidebar
          route={route} setRoute={setRoute}
          project={project} setProject={setProject}
          openProjectMenu={openMenu} setOpenProjectMenu={setOpenMenu}
        />
        {main}
      </div>
      <TweakPanel t={t} setTweak={setTweak} onLogout={() => { setSignedIn(false); }} />
    </>
  );
}

function TweakPanel({ t, setTweak, onLogout }) {
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="主题色" />
      <TweakColor label="品牌色" value={t.accent}
                  options={["#4FA89A","#5B8DD6","#9A7AC8","#D6A24B"]}
                  onChange={(v)=>setTweak("accent", v)} />
      <TweakSection label="演示控制" />
      <TweakToggle label="登录后默认展开思考详情" value={t.showThinkingByDefault}
                   onChange={(v)=>setTweak("showThinkingByDefault", v)} />
      {onLogout && (
        <TweakButton label="返回登录页演示" onClick={onLogout}>返回登录</TweakButton>
      )}
    </TweaksPanel>
  );
}

const root = ReactDOM.createRoot(document.getElementById("app-root"));
root.render(<App />);
