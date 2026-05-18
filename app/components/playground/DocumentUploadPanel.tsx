"use client";

import { useRef, useState } from "react";
import { DocumentRecord } from "@/lib/docStore";

interface Props {
  documents: DocumentRecord[];
  selectedId: string | null;
  onUploaded: (doc: DocumentRecord) => void;
  onSelect: (doc: DocumentRecord) => void;
}

export default function DocumentUploadPanel({ documents, selectedId, onUploaded, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <UploadArea onUploaded={onUploaded} />
      <DocumentLibrary documents={documents} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

function UploadArea({ onUploaded }: { onUploaded: (doc: DocumentRecord) => void }) {
  const [tab, setTab] = useState<"file" | "paste">("paste");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setError("");
    setUploading(true);
    try {
      let res: Response;
      if (tab === "file" && fileRef.current?.files?.[0]) {
        const form = new FormData();
        form.append("file", fileRef.current.files[0]);
        res = await fetch("/api/documents", { method: "POST", body: form });
      } else {
        if (!text.trim()) { setError("内容不能为空"); setUploading(false); return; }
        res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, fileName: fileName.trim() || "pasted-text.txt", mimeType: "text/plain" }),
        });
      }
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message ?? "上传失败"); return; }
      onUploaded(data.document);
      setText("");
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">上传文档</h3>

      {/* Tab */}
      <div className="flex gap-1 p-0.5 bg-zinc-100 rounded-lg w-fit">
        {(["paste", "file"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {t === "paste" ? "粘贴文本" : "上传文件"}
          </button>
        ))}
      </div>

      {tab === "paste" ? (
        <div className="flex flex-col gap-2">
          <input
            type="text"
            placeholder="文件名（可选，默认 pasted-text.txt）"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="w-full rounded border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 outline-none focus:border-zinc-400"
          />
          <textarea
            rows={8}
            placeholder="在此粘贴文档内容（支持 Markdown / 纯文本）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded border border-zinc-200 px-2.5 py-2 text-xs text-zinc-800 font-mono outline-none focus:border-zinc-400 resize-y"
          />
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-200 p-8 cursor-pointer hover:border-zinc-400 hover:bg-zinc-50 transition-colors">
          <span className="text-2xl">📄</span>
          <span className="text-xs text-zinc-500">点击选择或拖拽文件（MD / TXT / PDF）</span>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,.pdf,text/plain,text/markdown,application/pdf"
            className="sr-only"
          />
        </label>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        onClick={submit}
        disabled={uploading}
        className={`self-start px-4 py-2 rounded text-sm font-medium transition-colors ${
          uploading
            ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
            : "bg-zinc-900 text-white hover:bg-zinc-700"
        }`}
      >
        {uploading ? "上传中…" : "上传并保存"}
      </button>
    </section>
  );
}

function DocumentLibrary({
  documents,
  selectedId,
  onSelect,
}: {
  documents: DocumentRecord[];
  selectedId: string | null;
  onSelect: (doc: DocumentRecord) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        文档库 {documents.length > 0 && <span className="font-normal text-zinc-400">({documents.length})</span>}
      </h3>

      {documents.length === 0 ? (
        <p className="text-xs text-zinc-400">尚无文档，上传后会出现在这里。</p>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              selected={doc.id === selectedId}
              onSelect={() => onSelect(doc)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DocRow({
  doc,
  selected,
  onSelect,
}: {
  doc: DocumentRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const sizeStr = doc.fileSize < 1024
    ? `${doc.fileSize} B`
    : doc.fileSize < 1024 * 1024
    ? `${(doc.fileSize / 1024).toFixed(1)} KB`
    : `${(doc.fileSize / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
        selected
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white hover:border-zinc-400 text-zinc-800"
      }`}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <p className="text-xs font-medium truncate">{doc.fileName}</p>
        <p className={`text-[10px] font-mono truncate ${selected ? "text-zinc-300" : "text-zinc-400"}`}>
          {doc.hash.slice(0, 16)}…
        </p>
        <div className={`flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] ${selected ? "text-zinc-300" : "text-zinc-500"}`}>
          <span>v{doc.version}</span>
          <span>{sizeStr}</span>
          <span>{doc.mimeType}</span>
          <span>{new Date(doc.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
      <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${
        selected ? "bg-white text-zinc-900" : "bg-green-50 text-green-700"
      }`}>
        {selected ? "已选择" : doc.processingStatus === "ready" ? "就绪" : doc.processingStatus}
      </span>
    </div>
  );
}
