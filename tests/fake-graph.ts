/** Minimal in-memory Graph API for pipeline tests. Supports single calls and /batch. */

type Obj = { id: string; type: string; name?: string; status?: string; params: Record<string, string>; createdTime: string };
type Reply = { status: number; body: unknown };

export class FakeGraph {
  objects = new Map<string, Obj>();
  calls: { method: string; path: string; params: Record<string, string> }[] = [];
  /** What GET me/adaccounts returns. */
  remoteAccounts: Record<string, unknown>[] = [];
  /** Return an error body to make a specific call fail. */
  failOn: (method: string, path: string, params: Record<string, string>) => { code: number; message: string } | null = () => null;
  private seq = 1000;

  create(type: string, params: Record<string, string>): Obj {
    const id = String(++this.seq);
    const obj = { id, type, name: params.name, status: params.status, params, createdTime: new Date().toISOString() };
    this.objects.set(id, obj);
    return obj;
  }

  byType(type: string) {
    return [...this.objects.values()].filter((o) => o.type === type);
  }

  private handle(method: string, path: string, params: Record<string, string>): Reply {
    this.calls.push({ method, path, params });
    const injected = this.failOn(method, path, params);
    if (injected) return { status: 400, body: { error: { ...injected, type: "OAuthException" } } };

    if (method === "GET" && path === "me/adaccounts") return { status: 200, body: { data: this.remoteAccounts } };
    const [head, edge] = path.split("/");
    if (method === "POST" && edge === "adimages") return { status: 200, body: { images: { "f.jpg": { hash: `hash_${++this.seq}`, url: "https://x" } } } };
    if (method === "POST" && edge === "copies") {
      // Meta refuses synchronous deep copies of 3+ objects; every test tree is that big.
      if (params.deep_copy === "true") return { status: 400, body: { error: { code: 100, error_subcode: 1885194, message: "Copy request is too large" } } };
      const src = this.objects.get(head);
      if (!src) return { status: 400, body: { error: { code: 100, message: "Object does not exist" } } };
      const suffix = (JSON.parse(params.rename_options ?? "{}") as { rename_suffix?: string }).rename_suffix ?? "";
      const copy = this.create(src.type, {
        ...src.params,
        ...(params.campaign_id ? { campaign_id: params.campaign_id } : {}),
        ...(params.adset_id ? { adset_id: params.adset_id } : {}),
        name: `${src.name}${suffix}`,
        status: params.status_option,
      });
      return { status: 200, body: { [`copied_${src.type}_id`]: copy.id } };
    }
    const creatable: Record<string, string> = { adcreatives: "creative", campaigns: "campaign", adsets: "adset", ads: "ad" };
    if (method === "POST" && edge && creatable[edge]) return { status: 200, body: { id: this.create(creatable[edge], params).id } };
    if (method === "GET" && edge && creatable[edge]) {
      const filtering = params.filtering ? (JSON.parse(params.filtering) as { value: string }[]) : [];
      const name = filtering[0]?.value;
      const data = this.byType(creatable[edge])
        .filter((o) => !name || o.name === name)
        .filter((o) => head.startsWith("act_") || o.params.campaign_id === head || o.params.adset_id === head)
        .map((o) => ({
          id: o.id,
          name: o.name,
          adset_id: o.params.adset_id,
          ...(o.params.creative ? { creative: { id: (JSON.parse(o.params.creative) as { creative_id?: string }).creative_id } } : {}),
          created_time: o.createdTime,
        }));
      return { status: 200, body: { data } };
    }
    if (!edge) {
      const obj = this.objects.get(head);
      if (!obj) return { status: 400, body: { error: { code: 100, message: "Object does not exist" } } };
      if (method === "GET") {
        const creative = obj.params.creative ? { creative: { id: (JSON.parse(obj.params.creative) as { creative_id?: string }).creative_id } } : {};
        return { status: 200, body: { id: obj.id, name: obj.name, status: obj.status, effective_status: obj.status, adset_id: obj.params.adset_id, ...creative } };
      }
      if (method === "DELETE") {
        this.objects.delete(head);
        return { status: 200, body: { success: true } };
      }
      if (method === "POST") {
        if (params.status) obj.status = params.status;
        return { status: 200, body: { success: true } };
      }
    }
    return { status: 400, body: { error: { code: 100, message: `Unhandled ${method} ${path}` } } };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL ? input : new URL(String(input));
    const path = url.pathname.replace(/^\/v\d+\.\d+\/?/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const params: Record<string, string> = Object.fromEntries(url.searchParams);
    if (init?.body instanceof URLSearchParams) Object.assign(params, Object.fromEntries(init.body));

    if (method === "POST" && path === "" && params.batch) {
      const batch = JSON.parse(params.batch) as { method: string; relative_url: string; body?: string }[];
      const out = batch.map((b) => {
        const [p, qs] = b.relative_url.split("?");
        const sub = { ...Object.fromEntries(new URLSearchParams(qs ?? "")), ...Object.fromEntries(new URLSearchParams(b.body ?? "")) };
        const r = this.handle(b.method, p, sub);
        return { code: r.status, body: JSON.stringify(r.body) };
      });
      return Response.json(out);
    }
    const r = this.handle(method, path, params);
    return Response.json(r.body, { status: r.status });
  };
}
