// Inline SVG icons. Stroke-based, 1.6px. Title in zh-CN.
const Icon = ({ d, size = 16, stroke = 1.6, fill, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill={fill || "none"}
       stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
       style={{flex:"none"}} {...rest}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);

// generic line icons
const IconMessage = (p) => <Icon {...p} d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12Z" />;
const IconFolder  = (p) => <Icon {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />;
const IconUpload  = (p) => <Icon {...p} d={<><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>} />;
const IconClock   = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>} />;
const IconCog     = (p) => <Icon {...p} d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.1 14H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.2.6.7 1 1.4 1H21a2 2 0 0 1 0 4h-.1c-.7 0-1.2.4-1.4 1Z"/></>} />;
const IconSearch  = (p) => <Icon {...p} d={<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>} />;
const IconPlus    = (p) => <Icon {...p} d={<><path d="M12 5v14"/><path d="M5 12h14"/></>} />;
const IconChevron = (p) => <Icon {...p} d="m9 6 6 6-6 6" />;
const IconDown    = (p) => <Icon {...p} d="m6 9 6 6 6-6" />;
const IconUp      = (p) => <Icon {...p} d="m18 15-6-6-6 6" />;
const IconX       = (p) => <Icon {...p} d={<><path d="m18 6-12 12"/><path d="m6 6 12 12"/></>} />;
const IconCheck   = (p) => <Icon {...p} d="M5 12.5 10 17.5 19.5 7" />;
const IconBolt    = (p) => <Icon {...p} d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />;
const IconCopy    = (p) => <Icon {...p} d={<><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>} />;
const IconEdit    = (p) => <Icon {...p} d={<><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/></>} />;
const IconDownload= (p) => <Icon {...p} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>} />;
const IconRefresh = (p) => <Icon {...p} d={<><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></>} />;
const IconThumb   = (p) => <Icon {...p} d="M7 22V11l5-9c1 0 2 1 2 2v5h5a2 2 0 0 1 2 2.4l-1.5 7A2 2 0 0 1 17.5 22H7Z" />;
const IconThumbDn = (p) => <Icon {...p} d="M17 2v11l-5 9c-1 0-2-1-2-2v-5H5a2 2 0 0 1-2-2.4l1.5-7A2 2 0 0 1 6.5 2H17Z" />;
const IconStar    = (p) => <Icon {...p} d="M12 2.5 14.9 9l7 .7-5.3 4.7 1.6 6.9L12 17.8 5.8 21.3l1.6-7L2 9.7l7-.7 3-6.5Z" />;
const IconMic     = (p) => <Icon {...p} d={<><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></>} />;
const IconPaperclip=(p) => <Icon {...p} d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a2 2 0 0 1-2.8-2.8l8-8" />;
const IconSend    = (p) => <Icon {...p} d={<><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/></>} />;
const IconFile    = (p) => <Icon {...p} d={<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6"/></>} />;
const IconFilePdf = (p) => <Icon {...p} d={<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6"/><path d="M8 14h1.5a1.5 1.5 0 0 1 0 3H8v-3Zm0 0v5"/><path d="M13 14v5"/><path d="M13 17h2"/><path d="M13 14h2.5"/></>} />;
const IconBrain   = (p) => <Icon {...p} d="M9 3a3 3 0 0 0-3 3 3 3 0 0 0-3 3v4a3 3 0 0 0 3 3v2a3 3 0 0 0 6 0V3a3 3 0 0 0-3 0Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 3 3v4a3 3 0 0 1-3 3v2a3 3 0 0 1-6 0V3a3 3 0 0 1 3 0Z" />;
const IconSparkle = (p) => <Icon {...p} d={<><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/></>} />;
const IconTool    = (p) => <Icon {...p} d="M14.7 6.3a4 4 0 1 1 3 3l-1 1 7 7-3 3-7-7-1 1a4 4 0 1 1-3-3l5-5Z" />;
const IconDollar  = (p) => <Icon {...p} d={<><path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>} />;
const IconEye     = (p) => <Icon {...p} d={<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></>} />;
const IconArrowR  = (p) => <Icon {...p} d={<><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>} />;
const IconDots    = (p) => <Icon {...p} d={<><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></>} fill="currentColor" stroke="none" />;
const IconTrash   = (p) => <Icon {...p} d={<><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7h14l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7Z"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></>} />;
const IconBars    = (p) => <Icon {...p} d={<><path d="M3 18v-6"/><path d="M9 18V8"/><path d="M15 18v-3"/><path d="M21 18V4"/></>} />;
const IconLock    = (p) => <Icon {...p} d={<><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></>} />;
const IconUser    = (p) => <Icon {...p} d={<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>} />;
const IconLayers  = (p) => <Icon {...p} d={<><path d="m12 2 10 6-10 6L2 8l10-6Z"/><path d="m2 16 10 6 10-6"/><path d="m2 12 10 6 10-6"/></>} />;

// Stage glyph (a soft tile w/ icon, used for thinking phases)
const StageGlyph = ({ stage, size=22 }) => {
  const map = {
    think:  { c:"var(--think)",  bg:"var(--think-bg)",  icon: <IconBrain size={13} stroke={1.8} /> },
    search: { c:"var(--search)", bg:"var(--search-bg)", icon: <IconSearch size={13} stroke={1.8} /> },
    tool:   { c:"var(--tool)",   bg:"var(--tool-bg)",   icon: <IconTool size={13} stroke={1.8} /> },
    gen:    { c:"var(--gen)",    bg:"var(--gen-bg)",    icon: <IconSparkle size={13} stroke={1.8} /> },
  };
  const m = map[stage] || map.think;
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",justifyContent:"center",
      width:size,height:size,borderRadius:7,background:m.bg,color:m.c,flex:"none"
    }}>{m.icon}</span>
  );
};

Object.assign(window, {
  Icon, IconMessage, IconFolder, IconUpload, IconClock, IconCog, IconSearch, IconPlus,
  IconChevron, IconDown, IconUp, IconX, IconCheck, IconBolt, IconCopy, IconEdit,
  IconDownload, IconRefresh, IconThumb, IconThumbDn, IconStar, IconMic, IconPaperclip,
  IconSend, IconFile, IconFilePdf, IconBrain, IconSparkle, IconTool, IconDollar,
  IconEye, IconArrowR, IconDots, IconTrash, IconBars, IconLock, IconUser, IconLayers,
  StageGlyph
});
