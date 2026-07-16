import { describe, expect, it } from "vitest";

import { createDemo, isAllowed, SAMPLES } from "../../examples/acl_demo/acl-demo.js";

/**
 * Integration test for the tiptap-apcore ACL demo (examples/acl_demo).
 *
 * Verifies tiptap's tag-based role ACL: readonly may only read (query), editor
 * may also format but not destroy, admin may do everything.
 */
describe("tiptap-apcore ACL demo", () => {
  it("registers the sample commands", () => {
    const ids = createDemo("admin").list();
    expect(ids).toContain(SAMPLES.query);
    expect(ids).toContain(SAMPLES.format);
    expect(ids).toContain(SAMPLES.destructive);
  });

  it("readonly may only read (query)", async () => {
    const apcore = createDemo("readonly");
    expect(await isAllowed(apcore, SAMPLES.query)).toBe(true);
    expect(await isAllowed(apcore, SAMPLES.format)).toBe(false);
    expect(await isAllowed(apcore, SAMPLES.destructive)).toBe(false);
  });

  it("editor may format but not destroy", async () => {
    const apcore = createDemo("editor");
    expect(await isAllowed(apcore, SAMPLES.query)).toBe(true);
    expect(await isAllowed(apcore, SAMPLES.format)).toBe(true);
    expect(await isAllowed(apcore, SAMPLES.destructive)).toBe(false);
  });

  it("admin may do everything", async () => {
    const apcore = createDemo("admin");
    expect(await isAllowed(apcore, SAMPLES.query)).toBe(true);
    expect(await isAllowed(apcore, SAMPLES.format)).toBe(true);
    expect(await isAllowed(apcore, SAMPLES.destructive)).toBe(true);
  });
});
