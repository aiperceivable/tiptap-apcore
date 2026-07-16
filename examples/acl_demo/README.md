# tiptap-apcore ACL demo

Shows how tiptap-apcore enforces apcore **Access Control Lists (ACL)** on apcore
module calls — the cross-integration `examples/acl_demo/` pattern, in tiptap's
own domain.

tiptap governs **editor commands** (not REST `orders.*`), so this demo uses
tiptap's native `readonly` / `editor` / `admin` roles and its **tag-based**
`AclGuard`, rather than the `X-Roles` + `orders.delete`/`orders.list` contract
used by the web-framework integrations (fastapi / django / flask / nestjs /
axum).

## What it shows

| role | `query` (getHTML) | `format` (toggleBold) | `destructive` (clearContent) |
| --- | --- | --- | --- |
| `readonly` | ✅ | ❌ | ❌ |
| `editor` | ✅ | ✅ | ❌ |
| `admin` | ✅ | ✅ | ✅ |

## How it works

1. `new TiptapAPCore(editor, { acl: { role } })` builds the runtime with a single
   active role. `AclGuard` maps each role to a set of allowed command **tags**
   (`readonly → [query]`, `editor → [query, format, content, history,
   selection]`, `admin → + destructive`).
2. Every command is discovered from the editor's extensions and tagged by
   category (`query` / `format` / `content` / `destructive` / …).
3. `apcore.call(moduleId, {})` runs the ACL check first; a call whose tag is not
   permitted for the active role is rejected with an `ACL_DENIED` error before
   the editor command runs.

## Run it

```bash
npx tsx examples/acl_demo/acl-demo.ts
```

Prints the role × tag matrix above. Verified by
`tests/integration/acl-demo.test.ts`.

> **NOTE:** the demo uses a mock editor so it runs headlessly. Real apps pass a
> live TipTap `Editor` and switch roles at runtime with `apcore.setAcl({ role })`.
