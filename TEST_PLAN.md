# HumorFlavor Manager - Comprehensive Test Plan (QA Plan)

## Overview

This document outlines the complete test plan for the HumorFlavor Manager application—a Next.js-based admin tool for managing humor flavors, ordered prompt-chain steps, and testing caption generation against the AlmostCrackd API.

## Application Architecture

The system consists of:
- **Frontend**: React client with Tailwind CSS, Supabase authentication
- **Backend**: Next.js API routes handling CRUD operations for flavors, steps, and test execution
- **External Services**: Supabase (auth + database), AlmostCrackd (caption generation)
- **Database**: Supabase PostgreSQL with tables: `profiles`, `humor_flavors`, `humor_flavor_steps`, `caption_history`

---

## Test Tree: Logical Pathways

### Branch 1: Authentication & Access Control

**1.1 Unauthenticated Access**
- Attempt to access `/` without session → expect sign-in prompt
- Attempt API calls without Bearer token → expect 401 Unauthorized
- Verify Google OAuth redirect flow initiates correctly

**1.2 Authenticated but Unauthorized User**
- Sign in with valid Google account missing admin roles → expect "Access denied" message
- Verify `/api/admin/me` returns `authorized: false` for non-admin users

**1.3 Authenticated & Authorized Admin User**
- Sign in with valid admin account (is_superadmin or is_matrix_admin = true)
- Verify `/api/admin/me` returns `authorized: true`
- Verify admin UI renders without errors
- Verify sign-out clears session and redirects to sign-in

---

### Branch 2: Humor Flavor Management

**2.1 Create Flavor**
- Submit new flavor with valid name and description → verify POST `/api/admin/flavors` creates entry
- Submit flavor with blank name → expect validation error
- Verify flavor appears in left sidebar after creation
- Verify multiple flavors can be created sequentially

**2.2 Load & Display Flavors**
- On app load, GET `/api/admin/flavors` returns all flavors
- Verify flavors render as selectable buttons in sidebar
- Verify first flavor auto-selects if no previous selection stored
- Verify flavor selection persists across page refreshes

**2.3 Edit Flavor**
- Select a flavor and click edit → expect inline edit form
- Update name and description → PATCH `/api/admin/flavors/[flavorId]`
- Verify changes persist after save
- Cancel edit → expect form to close without changes

**2.4 Delete Flavor**
- Click delete on a flavor → expect confirmation dialog
- Confirm deletion → DELETE `/api/admin/flavors/[flavorId]`
- Verify flavor removed from sidebar and database
- Verify related steps are cascade-deleted

**2.5 Duplicate Flavor**
- Click duplicate on a flavor → expect name prompt
- Provide new name (or use default "Copy" suffix)
- POST `/api/admin/flavors/[flavorId]/duplicate` creates new flavor with copied steps
- Verify duplicate has unique name and all steps copied with new order indices

---

### Branch 3: Humor Flavor Steps (Prompt Chain)

**3.1 Create Step**
- Select a flavor and fill step creation form (title + prompt template)
- Choose input source (image or previous_step)
- POST `/api/admin/flavors/[flavorId]/steps` creates step
- Verify step appears in step list
- Verify order_index is auto-assigned

**3.2 Load & Display Steps**
- Select a flavor → GET `/api/admin/flavors/[flavorId]/steps`
- Verify all steps render in correct order
- Verify step order_index matches display position

**3.3 Edit Step**
- Click edit on a step → inline edit form
- Update title, prompt template, input source
- PATCH `/api/admin/steps/[stepId]` persists changes
- Verify changes visible immediately

**3.4 Delete Step**
- Click delete on a step → confirmation dialog
- Confirm → DELETE `/api/admin/steps/[stepId]`
- Verify step removed from list and database
- Verify remaining steps renumber correctly

**3.5 Reorder Steps (Drag/Arrow)**
- Move a step up/down using arrow buttons
- POST `/api/admin/flavors/[flavorId]/reorder` with new step IDs
- Verify order_index updates on all affected steps
- Verify UI reflects new order

**3.6 Step Validation**
- Attempt to create step with blank title → expect error
- Attempt to create step with blank prompt template → expect error
- Verify no invalid steps created

---

### Branch 4: Caption Generation & Testing

**4.1 Test Flavor with Image**
- Select a flavor with steps defined
- Enter valid image URL (https://...)
- Click "Test flavor" button
- Verify POST `/api/test-humor-flavor` executes successfully

**4.2 Caption Generation Flow**
- Verify pipeline steps execute in order:
  1. Generate presigned upload URL
  2. Upload image bytes to presigned URL
  3. Register image URL in pipeline
  4. Generate captions via AlmostCrackd
  5. Save history to database
- Verify captions display in "Generated captions" section
- Verify execution trace displays all steps with inputs/outputs

**4.3 Test History Tracking**
- Run test on a flavor → verify history entry created
- GET `/api/admin/flavors/[flavorId]/history?limit=10`
- Verify latest test appears at top of history
- Verify history includes captions, image URL, trace, and timestamp
- Verify multiple tests accumulate in history

**4.4 Test Validation**
- Attempt to test without flavor selected → expect error
- Attempt to test with blank image URL → expect error
- Attempt to test with invalid image URL → expect network error
- Verify no malformed history entries created

**4.5 Flavor-Specific vs. Default Captions**
- Test flavor with flavor-specific steps → verify captions respect flavor context
- If flavor generation fails, verify fallback to default captions
- Verify warning message displayed when fallback occurs

---

### Branch 5: Data Persistence & Edge Cases

**5.1 Session Recovery**
- Sign in as admin → create flavor + steps + run test
- Refresh page → verify session still active
- Verify flavor selection, steps, and history all persist
- Sign out → verify session cleared

**5.2 Concurrent Operations**
- Create two flavors rapidly → verify both created without conflicts
- Edit two steps in same flavor → verify no race conditions
- Create step while another request pending → verify proper queuing

**5.3 Large Data Sets**
- Create 20+ flavors → verify performance acceptable
- Create 50+ steps in one flavor → verify reorder/display responsive
- Verify history pagination works (limit param)

**5.4 Error Recovery**
- Trigger API error (e.g., 500 server error) → verify user-friendly error message
- Verify app remains usable after error (no frozen UI)
- Verify error details logged for debugging

**5.5 Schema Flexibility**
- Verify app handles missing optional columns gracefully
- Verify app handles alternate column names (flavor_name vs. name, etc.)
- Verify schema detection in duplicate/create endpoints works

---

### Branch 6: UI/UX & Accessibility

**6.1 Theme Toggle**
- Switch between light/dark/system themes
- Verify theme preference persists on reload
- Verify all components render correctly in each theme

**6.2 Responsive Design**
- Test on desktop (1920px), tablet (768px), mobile (375px)
- Verify layout adapts without horizontal scroll
- Verify buttons/inputs remain clickable on mobile

**6.3 Form Feedback**
- Verify loading states display during async operations
- Verify success messages appear after operations
- Verify error messages are clear and actionable

**6.4 Keyboard Navigation**
- Tab through form inputs
- Use Enter to submit forms
- Verify focus management works correctly

---

## Test Execution Strategy

### Environment Setup
1. Deploy app to Vercel with live Supabase + AlmostCrackd credentials
2. Set up test user account with admin roles
3. Prepare test image URLs for caption generation tests

### Test Runs
- **Run 1**: Full happy-path workflow (create → edit → duplicate → test)
- **Run 2**: Error cases & validation (invalid inputs, missing fields)
- **Run 3**: Edge cases & stress (concurrent ops, large data, recovery)

### Success Criteria
- All branches executed without unhandled errors
- No data loss or corruption
- All external API calls succeed or degrade gracefully
- UI remains responsive throughout all operations
- Auth flow prevents unauthorized access consistently

---

## Known Limitations & Out of Scope

- Performance testing (load testing, stress testing beyond manual ops)
- Browser compatibility testing (assumed modern browsers)
- Accessibility compliance audit (WCAG)
- Security penetration testing
- Mobile app (web-only)
- Offline functionality

---

## Test Data Requirements

- Valid Supabase project with configured OAuth provider (Google)
- AlmostCrackd API key and valid endpoint
- Admin test user account with `is_superadmin = true` or `is_matrix_admin = true`
- Sample image URLs (must be publicly accessible HTTPS)
- Pre-populated LLM lookup tables (llm_models, llm_input_types, llm_output_types, humor_flavor_step_types)

---

## Appendix: API Endpoint Reference

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/admin/flavors` | Required | List all flavors |
| POST | `/api/admin/flavors` | Required | Create new flavor |
| PATCH | `/api/admin/flavors/[flavorId]` | Required | Update flavor |
| DELETE | `/api/admin/flavors/[flavorId]` | Required | Delete flavor |
| POST | `/api/admin/flavors/[flavorId]/duplicate` | Required | Duplicate flavor with steps |
| GET | `/api/admin/flavors/[flavorId]/steps` | Required | List flavor's steps |
| POST | `/api/admin/flavors/[flavorId]/steps` | Required | Create step |
| PATCH | `/api/admin/steps/[stepId]` | Required | Update step |
| DELETE | `/api/admin/steps/[stepId]` | Required | Delete step |
| POST | `/api/admin/flavors/[flavorId]/reorder` | Required | Reorder steps |
| GET | `/api/admin/flavors/[flavorId]/history` | Required | List test history |
| POST | `/api/test-humor-flavor` | Required | Run caption test |
| GET | `/api/admin/me` | Required | Check authorization |

