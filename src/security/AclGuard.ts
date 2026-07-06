import type { AclConfig, Logger, ModuleDescriptor, AuditLogger } from "../types.js";
import { TiptapModuleError, ErrorCodes } from "../errors/index.js";

const ROLE_TAGS: Record<string, string[]> = {
  readonly: ["query"],
  editor: ["query", "format", "content", "history", "selection"],
  admin: ["query", "format", "content", "destructive", "history", "selection"],
};

export class AclGuard {
  private config: AclConfig | undefined;
  private logger: Logger | undefined;
  private auditLogger: AuditLogger | undefined;

  constructor(config?: AclConfig, logger?: Logger, auditLogger?: AuditLogger) {
    this.config = config;
    this.logger = logger;
    this.auditLogger = auditLogger;
  }

  /** Update ACL configuration at runtime */
  updateConfig(config: AclConfig | undefined): void {
    this.config = config;
    this.logger?.info?.("ACL configuration updated", { role: config?.role });
  }

  check(moduleId: string, descriptor: ModuleDescriptor): void {
    const allowed = this.isAllowed(moduleId, descriptor);
    const reason = allowed ? undefined : this.getDenialReason(moduleId, descriptor);

    // Record the enforcement decision in the structured audit trail (if any).
    this.audit(moduleId, allowed ? "allow" : "deny", reason);

    if (!allowed) {
      this.logger?.warn(`ACL denied: ${moduleId}`, { reason });
      throw new TiptapModuleError(
        ErrorCodes.ACL_DENIED,
        `Access denied: module '${moduleId}' is not permitted`,
        { moduleId },
      );
    }
  }

  /**
   * Append an ACL decision to the structured audit log, when configured.
   *
   * Emits an apcore-js `AuditEntry` (cross-ecosystem wire shape) with the
   * TipTap module ID as the `targetId`. Fields that have no meaning in the
   * editor domain (caller identity, named rules, trace/call-depth) are left
   * empty/null per the entry contract.
   */
  private audit(
    moduleId: string,
    decision: "allow" | "deny",
    reason?: string,
  ): void {
    if (!this.auditLogger) return;
    this.auditLogger({
      timestamp: new Date().toISOString(),
      callerId: "",
      targetId: moduleId,
      decision,
      reason: reason ?? "",
      matchedRule: null,
      matchedRuleIndex: null,
      identityType: null,
      roles: this.config?.role ? [this.config.role] : [],
      callDepth: null,
      traceId: null,
      handlerError: null,
    });
  }

  isAllowed(moduleId: string, descriptor: ModuleDescriptor): boolean {
    // No ACL config = all allowed (opt-in security)
    if (!this.config) return true;

    const { denyModules, allowModules, denyTags, allowTags, role } =
      this.config;
    const moduleTags = descriptor.tags ?? [];

    // 1. denyModules (highest precedence)
    if (denyModules?.includes(moduleId)) return false;

    // 2. allowModules
    if (allowModules && allowModules.length > 0) {
      if (allowModules.includes(moduleId)) return true;
    }

    // 3. denyTags
    if (denyTags && denyTags.length > 0) {
      if (moduleTags.some((t) => denyTags.includes(t))) return false;
    }

    // 4. allowTags
    if (allowTags && allowTags.length > 0) {
      if (moduleTags.some((t) => allowTags.includes(t))) return true;
    }

    // 5. Role-based
    if (role) {
      const roleTags = ROLE_TAGS[role];
      if (!roleTags) return false;
      return moduleTags.some((t) => roleTags.includes(t));
    }

    // 6. If any allow-list is present, default to deny; otherwise permissive
    const hasAllowList =
      (allowModules && allowModules.length > 0) ||
      (allowTags && allowTags.length > 0);
    return !hasAllowList;
  }

  private getDenialReason(
    moduleId: string,
    descriptor: ModuleDescriptor,
  ): string {
    if (!this.config) return "No ACL config";

    const { denyModules, denyTags, allowTags, allowModules, role } =
      this.config;
    const moduleTags = descriptor.tags ?? [];

    // 1. denyModules
    if (denyModules?.includes(moduleId)) {
      return `Module '${moduleId}' is in the denyModules list`;
    }

    // 2. allowModules set but module not in it
    if (allowModules && allowModules.length > 0) {
      if (!allowModules.includes(moduleId)) {
        return `Module '${moduleId}' is not in the allowModules list`;
      }
    }

    // 3. denyTags
    if (denyTags && denyTags.length > 0) {
      const denied = moduleTags.filter((t) => denyTags.includes(t));
      if (denied.length > 0) {
        return `Module tags [${denied.join(", ")}] are in the denyTags list`;
      }
    }

    // 4. allowTags set but no overlap
    if (allowTags && allowTags.length > 0) {
      if (!moduleTags.some((t) => allowTags.includes(t))) {
        return `Module tags [${moduleTags.join(", ")}] are not in the allowTags list`;
      }
    }

    // 5. Role-based denial
    if (role) {
      const roleTags = ROLE_TAGS[role];
      if (!roleTags) {
        return `Unknown role '${role}'`;
      }
      return `Role '${role}' does not permit tags [${moduleTags.join(", ")}]`;
    }

    return "Access denied by policy";
  }
}
