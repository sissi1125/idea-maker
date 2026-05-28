/**
 * Notes 模块类型 — feat-200.7 Week 7
 *
 * 笔记库（saved notes）：用户把 generation 结果（原版或编辑后）保存进库，作为可复用的内容资产。
 * 笔记可关联到一条 generation（来源溯源），也可以独立创建（generation_id=null）。
 */

export interface NoteRow {
  id: string;
  projectId: string;
  generationId: string | null;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 创建：必须有 title + content，generationId / tags 可选 */
export interface CreateNoteInput {
  generationId?: string | null;
  title: string;
  content: string;
  tags?: string[];
}

/** 更新：所有字段都可选；至少一个有值（service 层校验） */
export interface UpdateNoteInput {
  title?: string;
  content?: string;
  tags?: string[];
}
