/**
 * Tabs — feat-300.6 任务 3（基础组件）
 *
 * 简易 Tab 容器，零 UI 库依赖（项目零 UI lib 原则）。
 *
 * 设计要点：
 *   1. **URL 同步**：当前 tab 写到 URL `?tab=<id>`，刷新保留 + 可分享 deep link
 *   2. **受控外貌 + 非受控内核**：activeTab 由 URL 单一来源（避免 React state 与 URL 漂移）
 *   3. **键盘可达**：Tab/Shift+Tab 切焦点 + Enter/Space 触发（role=tab + aria-selected）
 *   4. **空数据态**：没有 tabs 时返回 null（防御调用方误传空数组）
 *
 * 为什么不用 nuqs：本项目零额外依赖；URLSearchParams + useRouter.replace 25 行能搞定。
 */

"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect } from "react";

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  /** Tab 定义列表 */
  tabs: TabItem[];
  /** URL search param 名字，默认 'tab'（同一页多组 tab 时传不同 name） */
  paramName?: string;
  /** 默认 tab id（URL 无 ?tab= 时用） */
  defaultTab?: string;
  /** 各 Tab 对应的 content，按 id 索引 */
  children: Record<string, React.ReactNode>;
  /** 切 tab 副作用（可选，比如埋点） */
  onChange?: (id: string) => void;
  /** 让外层调整布局：sticky / scroll 等 */
  className?: string;
}

export function Tabs({
  tabs,
  paramName = "tab",
  defaultTab,
  children,
  onChange,
  className,
}: TabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const fromUrl = search.get(paramName);
  const fallback = defaultTab ?? tabs[0]?.id;
  const activeId = fromUrl && tabs.some((t) => t.id === fromUrl) ? fromUrl : fallback;

  // 当 URL 没有 ?tab= 时，写入 fallback 以让用户拿到 deep link 真实可分享
  // 注意：用 replace 不用 push（不污染 history 后退栈）
  useEffect(() => {
    if (!fromUrl && fallback) {
      const sp = new URLSearchParams(search.toString());
      sp.set(paramName, fallback);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    }
    // 仅 mount 时同步一次，后续切 tab 走 setActive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tabs.length === 0 || !activeId) return null;

  const setActive = (id: string) => {
    if (id === activeId) return;
    const sp = new URLSearchParams(search.toString());
    sp.set(paramName, id);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    onChange?.(id);
  };

  return (
    <div className={className}>
      {/* Tab 头部 */}
      <div
        role="tablist"
        className="flex items-center gap-1 border-b border-gray-200"
      >
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`tab-panel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition ${
                active
                  ? "border-emerald-600 text-emerald-700 font-medium"
                  : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容（只渲染当前 tab，避免 mount 全部隐藏 tab 浪费资源） */}
      <div
        role="tabpanel"
        id={`tab-panel-${activeId}`}
        aria-labelledby={`tab-${activeId}`}
        className="pt-4"
      >
        {children[activeId] ?? null}
      </div>
    </div>
  );
}
