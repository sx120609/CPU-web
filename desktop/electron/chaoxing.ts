/**
 * 学习通 API 客户端
 *
 * 登录方式：用户在官方登录页完成登录 → 主进程从 BrowserWindow session
 * 读取 cookies → 通过 injectCookies() 注入到本模块的 HTTP 客户端。
 *
 * 本模块负责：课程列表、章节树、构造学习页面 URL。
 */
import axios, { type AxiosInstance } from "axios";

// ──────────── 类型定义 ────────────

export interface CxUser {
  uid: string;
  name: string;
  phone: string;
}

export interface CxCourse {
  courseId: string;
  clazzId: string;
  cpi: string;
  name: string;
  teacher: string;
  image: string;
  progress: number | null;
}

export interface CxChapter {
  id: string;
  name: string;
  layer: number;
  status: "locked" | "unfinished" | "finished";
  children: CxChapter[];
  taskPoints: CxTaskPoint[];
}

export interface CxTaskPoint {
  id: string;
  title: string;
  type: "video" | "document" | "ppt" | "quiz" | "other";
  status: "unfinished" | "finished";
  objectId?: string;
  duration?: number;
  cardIndex?: number;
}

// ──────────── Cookie 管理 ────────────

let cookieStr = "";
let currentUser: CxUser | null = null;

/** 从 Electron session 拿到的 cookies 注入到 HTTP 客户端 */
export function injectCookies(entries: { name: string; value: string }[]) {
  cookieStr = entries.map((e) => `${e.name}=${e.value}`).join("; ");

  const uid = entries.find((e) => e.name === "_uid")?.value || "";
  if (uid && uid !== "0") {
    currentUser = { uid, name: uid, phone: "" };
  }
}

function createHttp(baseURL: string): AxiosInstance {
  const inst = axios.create({
    baseURL,
    timeout: 30_000,
    maxRedirects: 5,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });
  inst.interceptors.request.use((cfg) => {
    if (cookieStr) cfg.headers.Cookie = cookieStr;
    return cfg;
  });
  // 跟踪 set-cookie（部分接口会刷新 cookies）
  inst.interceptors.response.use((res) => {
    const sc = res.headers["set-cookie"];
    if (sc) {
      const arr = Array.isArray(sc) ? sc : [sc];
      const existing: Record<string, string> = {};
      for (const pair of cookieStr.split("; ")) {
        const [k, ...v] = pair.split("=");
        if (k) existing[k.trim()] = v.join("=");
      }
      for (const h of arr) {
        const m = h.match(/^([^=]+)=([^;]*)/);
        if (m) existing[m[1].trim()] = m[2].trim();
      }
      cookieStr = Object.entries(existing)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    }
    return res;
  });
  return inst;
}

const mooc1 = createHttp("https://mooc1.chaoxing.com");
const mooc1Api = createHttp("https://mooc1-api.chaoxing.com");

// ──────────── 公共方法 ────────────

export function chaoxingLogout() {
  cookieStr = "";
  currentUser = null;
}

export function getCxUser(): CxUser | null {
  return currentUser;
}

export function isLoggedIn(): boolean {
  return !!cookieStr && cookieStr.includes("_uid=");
}

// ──────────── 课程列表 ────────────

export async function getCourses(): Promise<CxCourse[]> {
  const courses: CxCourse[] = [];
  try {
    const { data } = await mooc1Api.get("/mycourse/backclazzdata", {
      params: { view: "json", rss: 1 },
    });

    if (data?.result === 1 && data.channelList) {
      for (const ch of data.channelList) {
        if (!ch.content?.course) continue;
        const c = ch.content.course;
        const cpi = ch.cpi || ch.content.cpi || "";
        courses.push({
          courseId: String(c.data[0]?.id || ""),
          clazzId: String(ch.content.id || ch.key || ""),
          cpi: String(cpi),
          name: c.data[0]?.name || "未知课程",
          teacher: ch.content.teacherfactor || "",
          image: c.data[0]?.imageurl || "",
          progress: null,
        });
      }
    }
  } catch { /* 返回空列表 */ }
  return courses;
}

// ──────────── 章节树 ────────────

export async function getChapters(
  courseId: string,
  clazzId: string,
  cpi: string
): Promise<CxChapter[]> {
  // 方式 1：通过 /gas/clazz 接口
  try {
    const { data } = await mooc1.get("/gas/clazz", {
      params: {
        id: clazzId,
        courseId,
        fields:
          "id,bbsid,classscore,isstart,allowdownload,chatid,name,state,isfiled,visiblescore,begindate,coursesetting.fields(id,courseid,hiddencoursecover,closedali498498,hiddenwrongset),course.fields(id,name,infocontent,objectid,app,bulletformat,mappingcourseid,imageurl,teacherfactor,knowledge.fields(id,name,indexOrder,parentnodeid,status,layer,label,begintime,createtime,endtime,attachment.fields(id,type,objectId,extension).type(video)))",
      },
    });
    console.log("[chaoxing] /gas/clazz response keys:", data ? Object.keys(data) : "null");

    // 尝试多种可能的数据路径
    let knowledgeNodes: any[] | null = null;

    if (data?.data && Array.isArray(data.data)) {
      // 可能是 data.data 直接就是章节数组
      const first = data.data[0];
      if (first?.course?.data?.[0]?.knowledge) {
        knowledgeNodes = first.course.data[0].knowledge;
        console.log("[chaoxing] found knowledge at data.data[0].course.data[0].knowledge, count:", knowledgeNodes!.length);
      } else if (first?.knowledge) {
        knowledgeNodes = first.knowledge;
        console.log("[chaoxing] found knowledge at data.data[0].knowledge, count:", knowledgeNodes!.length);
      } else if (first?.id && first?.name) {
        // data.data 本身就是章节列表
        const result = parseChapterTree(data.data);
        console.log("[chaoxing] data.data is chapter list, count:", result.length);
        if (result.length > 0) return result;
      }
    }

    if (knowledgeNodes && knowledgeNodes.length > 0) {
      return parseKnowledgeNodes(knowledgeNodes);
    }
  } catch (e) {
    console.error("[chaoxing] /gas/clazz failed:", String(e));
  }

  // 方式 2：从学习页面 HTML 提取章节
  try {
    console.log("[chaoxing] trying studentstudy page fallback...");
    const chapters = await getChaptersFromStudyPage(courseId, clazzId, cpi);
    console.log("[chaoxing] studentstudy fallback got:", chapters.length, "chapters");
    if (chapters.length > 0) return chapters;
  } catch (e) {
    console.error("[chaoxing] studentstudy fallback failed:", String(e));
  }

  // 方式 3：通过 /mycourse/studentstudyAjax 接口
  try {
    console.log("[chaoxing] trying studentstudyAjax fallback...");
    const { data } = await mooc1.get("/mycourse/studentstudyAjax", {
      params: { courseId, clazzid: clazzId, cpi, verificationcode: "" },
    });
    if (data?.data) {
      const chapters = parseFlatChapterList(data.data);
      console.log("[chaoxing] studentstudyAjax got:", chapters.length, "chapters");
      if (chapters.length > 0) return chapters;
    }
  } catch (e) {
    console.error("[chaoxing] studentstudyAjax failed:", String(e));
  }

  console.error("[chaoxing] all chapter fetch methods failed");
  return [];
}

function parseChapterTree(nodes: any[]): CxChapter[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n) => ({
    id: String(n.id || ""),
    name: n.name || "未知章节",
    layer: n.layer || 0,
    status: n.status === 2 ? "finished" as const : n.status === 0 ? "locked" as const : "unfinished" as const,
    children: n.knowledge ? parseKnowledgeNodes(n.knowledge) : [],
    taskPoints: [],
  }));
}

function parseKnowledgeNodes(nodes: any[]): CxChapter[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((k) => {
    const points: CxTaskPoint[] = [];
    if (k.attachment) {
      for (const att of Array.isArray(k.attachment) ? k.attachment : []) {
        points.push({
          id: String(att.id || ""),
          title: att.name || k.name || "",
          type: detectTaskType(att.type, att.extension),
          status: "unfinished",
          objectId: att.objectId,
        });
      }
    }
    return {
      id: String(k.id || ""),
      name: k.name || "",
      layer: k.layer || 1,
      status: k.status === 2 ? "finished" as const : "unfinished" as const,
      children: [],
      taskPoints: points,
    };
  });
}

function detectTaskType(type: string | number, ext?: string): CxTaskPoint["type"] {
  const t = String(type).toLowerCase();
  if (t === "video" || ext === "mp4" || ext === "flv") return "video";
  if (t === "document" || ext === "pdf" || ext === "doc" || ext === "docx") return "document";
  if (t === "ppt" || ext === "ppt" || ext === "pptx") return "ppt";
  if (t === "workorexam" || t === "work") return "quiz";
  return "other";
}

async function getChaptersFromStudyPage(
  courseId: string,
  clazzId: string,
  cpi: string
): Promise<CxChapter[]> {
  const { data: html } = await mooc1.get("/mycourse/studentstudy", {
    params: { chapterId: "", courseId, clazzid: clazzId, cpi, mooc2: 1 },
    responseType: "text",
  });
  const match = (html as string).match(/try\s*\{\s*mArrange\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[1]);
    return arr.map((item: any) => ({
      id: String(item.id || ""),
      name: item.name || "",
      layer: item.layer || 0,
      status: item.status === 2 ? "finished" as const : "unfinished" as const,
      children: [],
      taskPoints: [],
    }));
  } catch {
    return [];
  }
}

function parseFlatChapterList(nodes: any[]): CxChapter[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((item: any) => ({
    id: String(item.id || item.chapterId || ""),
    name: item.name || item.title || "",
    layer: item.layer || 0,
    status: item.status === 2 ? "finished" as const : "unfinished" as const,
    children: [],
    taskPoints: [],
  }));
}

export function buildStudyUrl(
  courseId: string,
  clazzId: string,
  chapterId: string,
  cpi: string
): string {
  return `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=${chapterId}&courseId=${courseId}&clazzid=${clazzId}&cpi=${cpi}&mooc2=1`;
}
