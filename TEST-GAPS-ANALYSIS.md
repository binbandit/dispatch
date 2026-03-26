# 🔍 Critical Test Gaps & Missing Coverage Analysis

## 🚨 HIGH SEVERITY - Untested Failure Points

### 1. **IPC Error Handling** ⚠️ CRITICAL
**File:** `src/main/ipc-handler.ts`

**Missing Tests:**
```typescript
// Line 336-343: Generic error catch - not tested for specific errors
try {
  const result = await (handler as any)(args);
  return { ok: true, data: result ?? null };
} catch (error) {
  return { ok: false, error: error.message };
}
```

**Untested Scenarios:**
- [ ] IPC handler throws non-Error object
- [ ] IPC handler returns undefined/null
- [ ] IPC timeout (hanging promises)
- [ ] Multiple concurrent IPC calls to same handler
- [ ] IPC call during window closing
- [ ] Invalid method name handling
- [ ] Malformed args payload

**Impact:** Frontend could hang indefinitely, silent failures

---

### 2. **GitHub CLI Command Failures** ⚠️ CRITICAL
**File:** `src/main/services/gh-cli.ts` (2015 lines, 0 comprehensive tests)

**Missing Tests:**
- [ ] `gh` command not found
- [ ] `gh` not authenticated
- [ ] GitHub API rate limiting
- [ ] Network timeout during PR fetch
- [ ] Malformed JSON from gh CLI
- [ ] Git remote URL parsing failure (line 159)
- [ ] Concurrent gh commands interfering
- [ ] Stdout buffer overflow for large diffs
- [ ] Unicode handling in PR titles/bodies

**Untested Error Paths:**
```typescript
// Line 81: Rethrows errors without context
} catch (error) {
  throw error; // What errors? When? How to recover?
}

// Line 159: Throws on URL parse failure - not tested
throw new Error(`Could not parse owner/repo from remote URL: ${url}`);
```

**Impact:** App crash, data loss, incorrect merge operations

---

### 3. **Merge Queue State Transitions** ⚠️ HIGH
**Files:** `merge-button.tsx`, `floating-review-bar.tsx`

**Missing Tests:**
- [ ] PR enters queue then CI fails
- [ ] PR in queue, base branch force-pushed
- [ ] PR removed from queue by another user
- [ ] Queue position changes during polling
- [ ] Admin bypass while PR in queue (race condition)
- [ ] Queue status API fails mid-operation
- [ ] PR merged externally while showing "in queue"

**Critical Race Condition:**
```typescript
// What if queueStatus changes between check and merge?
if (queueStatus?.inQueue) {
  return <QueueStatus />; // User sees queue UI
}
// But PR could enter queue after this check!
```

**Impact:** Duplicate merges, queue bypass when not intended

---

### 4. **Diff Parser Edge Cases** ⚠️ HIGH
**File:** `src/renderer/lib/diff-parser.ts` (394 lines)

**Existing tests:** Basic parsing only

**Missing Edge Cases:**
- [ ] Binary file diffs
- [ ] Extremely large diffs (>10MB)
- [ ] Diffs with merge conflicts markers
- [ ] Malformed diff headers
- [ ] Unicode in file paths
- [ ] Special characters in filenames (spaces, quotes, backslashes)
- [ ] Renames with content changes
- [ ] Empty file additions/deletions
- [ ] Diff with no newline at end of file
- [ ] Mixed line endings (CRLF/LF)

**Impact:** UI crash, incorrect diff display, security issues

---

### 5. **AI Service Error Handling** ⚠️ HIGH
**File:** `src/main/services/ai.ts`

**Missing Tests:**
- [ ] OpenAI API key invalid/expired
- [ ] Anthropic rate limit exceeded
- [ ] Ollama server not running
- [ ] Network timeout during streaming
- [ ] Partial response (connection dropped mid-stream)
- [ ] Invalid JSON in API response
- [ ] Token limit exceeded
- [ ] Provider-specific error codes

**Untested Error Paths:**
```typescript
// Lines 97, 103, 107, 149, 180, 202: All throw without retry logic
throw new Error(`AI model is not configured for ${config.provider}.`);
throw new Error(`OpenAI API error: ${response.status} ${text}`);
```

**Impact:** Features fail silently, no user feedback, API quota waste

---

## 🟡 MEDIUM SEVERITY - Integration Gaps

### 6. **PR Search Performance & Edge Cases**
**File:** `src/renderer/lib/pr-search.ts` (617 lines)

**Missing Tests:**
- [ ] Search with 1000+ PRs (performance)
- [ ] Unicode search terms (emoji, Chinese, Arabic)
- [ ] Special regex characters in search
- [ ] Concurrent search updates (rapid typing)
- [ ] Search on stale data
- [ ] Fuzzy matching edge cases
- [ ] Combined filters (multiple `is:` clauses)

---

### 7. **File System Operations**
**Files:** `gh-cli.ts`, `git-cli.ts`, `database.ts`

**Missing Tests:**
- [ ] Repo directory deleted during operation
- [ ] Permission denied on .git directory
- [ ] Disk full during cache write
- [ ] Corrupted database file
- [ ] Database locked by another process
- [ ] Git worktree complications
- [ ] Symlinked repository paths

---

### 8. **React Query Cache Invalidation**
**File:** `query-client.ts`

**Missing Tests:**
- [ ] Stale data shown after merge
- [ ] Cache invalidation during background refetch
- [ ] Multiple tabs invalidating same cache
- [ ] Query cancellation on unmount
- [ ] Retry logic on network failure
- [ ] Background refetch error handling

---

### 9. **Notification Permission States**
**File:** `src/renderer/lib/notifications.ts`

**Partially Tested (29 tests exist)** but missing:
- [ ] Permission revoked after being granted
- [ ] Notification clicked while app in background
- [ ] Notification queue overflow (too many)
- [ ] System notification center disabled
- [ ] Duplicate notification handling

---

### 10. **Syntax Highlighting Failures**
**File:** `src/renderer/lib/highlighter.ts`

**Missing Tests:**
- [ ] WASM loading failure
- [ ] Theme not found fallback
- [ ] Language not supported fallback
- [ ] Very large files (>1MB)
- [ ] Highlighting during rapid navigation
- [ ] Memory leak on repeated highlights

---

## 🟢 LOW SEVERITY - Edge Cases

### 11. **Keybinding Conflicts**
**File:** `keybinding-registry.ts` (46 tests exist)

**Missing:**
- [ ] Duplicate keybinding registration
- [ ] Platform-specific conflicts (Mac vs Windows)
- [ ] Browser-reserved shortcuts
- [ ] Input field focus handling

---

### 12. **Format Utilities Edge Cases**
**File:** `shared/format.ts` (92 tests exist - GOOD!)

**Additional edge cases:**
- [ ] Timezone handling for `relativeTime`
- [ ] DST boundary crossing
- [ ] Leap seconds
- [ ] System clock changes

---

## 🎯 Critical User Flows - Not Tested E2E

### Flow 1: "Emergency Merge" - Admin Bypass
```
1. PR with failing CI
2. User clicks "Merge now (admin)"
3. Concurrent: Another user merges same PR
4. Result: ??? (Not tested)
```

### Flow 2: "Review Request Loop"
```
1. User requests review
2. Reviewer approves
3. New commit pushed (auto re-request review)
4. Multiple re-requests in quick succession
5. Result: ??? (Not tested)
```

### Flow 3: "Stale Branch Recovery"
```
1. PR behind base branch
2. User clicks "Update branch"
3. Update fails (conflicts)
4. User tries to merge anyway
5. Result: ??? (Not tested)
```

### Flow 4: "Network Failure Recovery"
```
1. User opens PR detail
2. Network drops
3. React Query retries
4. Network returns
5. Data consistency: ??? (Not tested)
```

---

## 🔐 Security Gaps - Not Tested

### S1. Command Injection
**File:** `shell.ts`, `gh-cli.ts`, `git-cli.ts`

- [ ] PR title with shell metacharacters
- [ ] Branch name with backticks/quotes
- [ ] Repo path with `../` traversal
- [ ] Environment variable injection

### S2. XSS Prevention
**File:** React components rendering PR content

- [ ] PR title with `<script>` tags
- [ ] Comment body with JS event handlers
- [ ] Markdown XSS vectors
- [ ] SVG-based XSS in images

### S3. Path Traversal
**File:** `diff-parser.ts`, `file-tree` components

- [ ] File path with `../../etc/passwd`
- [ ] Symlink following
- [ ] Absolute paths in diffs

---

## 📊 Test Coverage Recommendations

### Priority 1: Immediate (This Week)
1. ✅ IPC error handling tests
2. ✅ Merge queue race conditions
3. ✅ GitHub CLI failure modes
4. ✅ Diff parser edge cases

### Priority 2: Short-term (Next Sprint)
5. ✅ AI service error recovery
6. ✅ PR search performance
7. ✅ File system failure handling
8. ✅ Security injection tests

### Priority 3: Long-term (Backlog)
9. ✅ E2E critical user flows
10. ✅ Cache invalidation corner cases
11. ✅ Concurrent operation tests
12. ✅ Memory leak validation

---

## 📈 Metrics

**Current Coverage:**
- Unit tests: 357 tests across 16 files
- Integration tests: 0
- E2E tests: 0
- Security tests: 0

**Recommended Coverage:**
- Unit tests: 500+ tests (add 143)
- Integration tests: 50+ tests (new)
- E2E tests: 20+ critical flows (new)
- Security tests: 30+ scenarios (new)

**Total Recommended:** ~600 tests (68% increase)

---

## 🎯 Next Steps

### Immediate Actions:
1. Create `ipc-handler.test.ts` with error scenarios
2. Expand `merge-strategy.test.ts` with race conditions
3. Create `gh-cli-errors.test.ts` for failure modes
4. Add security tests for command injection

### Tooling Needs:
1. Integration test framework setup
2. E2E test runner (Playwright?)
3. Mock GitHub API server
4. Performance benchmarking suite

### Process Improvements:
1. Require tests for all error handlers
2. Code review checklist for edge cases
3. Pre-merge integration test gate
4. Quarterly security audit
