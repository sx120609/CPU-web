/**
 * 学习通 API 客户端
 *
 * 使用 HTTP 请求直接与学习通通信，不依赖浏览器。
 * 登录后维护 cookies，供后续 API 调用和 BrowserWindow 共用。
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
  // 视频相关
  objectId?: string;
  duration?: number;
  // 构造学习页面 URL 所需参数
  cardIndex?: number;
}

// ──────────── Cookie 管理 ────────────

let cookieStr = "";
let currentUser: CxUser | null = null;

function parseCookies(setCookieHeaders: string[]): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const h of setCookieHeaders) {
    const m = h.match(/^([^=]+)=([^;]*)/);
    if (m) jar[m[1].trim()] = m[2].trim();
  }
  return jar;
}

function mergeCookies(newCookies: Record<string, string>) {
  const existing: Record<string, string> = {};
  if (cookieStr) {
    for (const pair of cookieStr.split("; ")) {
      const [k, ...v] = pair.split("=");
      if (k) existing[k.trim()] = v.join("=");
    }
  }
  Object.assign(existing, newCookies);
  cookieStr = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
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
  inst.interceptors.response.use((res) => {
    const sc = res.headers["set-cookie"];
    if (sc) mergeCookies(parseCookies(Array.isArray(sc) ? sc : [sc]));
    return res;
  });
  return inst;
}

const passport = createHttp("https://passport2.chaoxing.com");
const mooc1 = createHttp("https://mooc1.chaoxing.com");
const mooc1Api = createHttp("https://mooc1-api.chaoxing.com");
const moocApi = createHttp("https://mooc2-ans.chaoxing.com");

// ──────────── 登录 ────────────

export async function chaoxingLogin(
  phone: string,
  password: string
): Promise<{ ok: boolean; user?: CxUser; error?: string }> {
  try {
    const encoded = Buffer.from(password, "utf-8").toString("base64");
    const { data } = await passport.post(
      "/fanyalogin",
      new URLSearchParams({
        fid: "-1",
        uname: phone,
        password: encoded,
        refer: "https://i.chaoxing.com",
        t: "true",
        forbidotherlogin: "0",
        validate: "",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    if (!data.status) {
      return { ok: false, error: data.msg2 || data.msg || "登录失败" };
    }

    // 从 cookies 中提取 uid
    const uid = cookieStr.match(/_uid=([^;]+)/)?.[1] || "";
    const user: CxUser = { uid, name: "", phone };

    // 获取用户名
    try {
      const profile = await mooc1Api.get("/mycourse/backclazzdata", {
        params: { view: "json", rss: 1 },
      });
      // backclazzdata 有时在 channelList 里返回用户信息
      if (profile.data?.result === 1) {
        user.name = phone; // 兜底
      }
    } catch {
      user.name = phone;
    }

    currentUser = user;
    return { ok: true, user };
  } catch (e: any) {
    return { ok: false, error: e.message || "网络错误" };
  }
}

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

/** 返回当前 cookies 的键值对，供 BrowserWindow session 注入 */
export function getCookieEntries(): { name: string; value: string }[] {
  if (!cookieStr) return [];
  return cookieStr.split("; ").map((pair) => {
    const [name, ...rest] = pair.split("=");
    return { name: name.trim(), value: rest.join("=") };
  });
}

// ──────────── 课程列表 ────────────

export async function getCourses(): Promise<CxCourse[]> {
  const courses: CxCourse[] = [];

  try {
    // 尝试 backclazzdata 接口
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
  } catch {
    // 接口出错则返回空列表
  }

  return courses;
}

// ──────────── 章节树 ────────────

export async function getChapters(
  courseId: string,
  clazzId: string,
  cpi: string
): Promise<CxChapter[]> {
  try {
    // 获取章节列表页面（JSON格式）
    const { data } = await mooc1.get(
      "/gas/clazz",
      {
        params: {
          id: clazzId,
          courseId,
          fields: "id,bbsid,classscore,isstart,allowdownload,chatid,name,state,isfiled,visiblescore,begindate,coursesetting.fields(id,courseid,hiddencoursecover,closedali498498,hiddenwrongset),course.fields(id,name,infocontent,objectid,app,bulletformat,mappingcourseid,imageurl,teacherfactor,knowledge.fields(id,name,indexOrder,parentnodeid,status,layer,label,begintime,createtime,endtime,attachment.fields(id,type,objectId,extension).type(video)))",
        },
      }
    );

    if (!data?.data) return [];

    return parseChapterTree(data.data);
  } catch (e) {
    // 备用方案：通过课程学习页面解析章节
    try {
      return await getChaptersFromStudyPage(courseId, clazzId, cpi);
    } catch {
      return [];
    }
  }
}

function parseChapterTree(nodes: any[]): CxChapter[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n) => {
    const chapter: CxChapter = {
      id: String(n.id || ""),
      name: n.name || "未知章节",
      layer: n.layer || 0,
      status: n.status === 2 ? "finished" : n.status === 0 ? "locked" : "unfinished",
      children: [],
      taskPoints: [],
    };

    // 解析知识点中的附件（视频等）
    if (n.knowledge) {
      chapter.children = parseKnowledgeNodes(n.knowledge);
    }

    return chapter;
  });
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
      status: k.status === 2 ? "finished" : "unfinished",
      children: [],
      taskPoints: points,
    } as CxChapter;
  });
}

function detectTaskType(type: string | number, ext?: string): CxTaskPoint["type"] {
  const t = String(type).toLowerCase();
  if (t === "video" || ext === "mp4" || ext === "flv") return "video";
  if (t === "document" || ext === "pdf" || ext === "doc" || ext === "docx") return "document";
  if (t === "ppt" || ext === "ppt" || ext === "pptx") return "ppt";
  if (t === "workOrExam" || t === "work") return "quiz";
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

  // 从页面 HTML 中提取章节 JSON
  const match = (html as string).match(/try\s*\{\s*mArrange\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) return [];

  try {
    const arr = JSON.parse(match[1]);
    return arr.map((item: any) => ({
      id: String(item.id || ""),
      name: item.name || "",
      layer: item.layer || 0,
      status: item.status === 2 ? "finished" : "unfinished",
      children: [],
      taskPoints: [],
    }));
  } catch {
    return [];
  }
}

// ──────────── 构造学习页面 URL ────────────

export function buildStudyUrl(
  courseId: string,
  clazzId: string,
  chapterId: string,
  cpi: string
): string {
  return `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=${chapterId}&courseId=${courseId}&clazzid=${clazzId}&cpi=${cpi}&mooc2=1`;
}
