// Prompts for GPT-4 Vision-based web automation agent

export const VISION_DECISION_PROMPT = `
You're analyzing screenshots to automate web tasks. Look at the current state and decide the next action.

TASK: {objective}
URL: {currentUrl}
RECENT ACTIONS: {actionHistory}
VISIBLE ELEMENTS: {domContext}

{recoveryContext}

Return JSON:
{
  "stateDescription": "what you see",
  "nextAction": {
    "type": "click|type|wait|navigate|complete|scroll",
    "target": "element to interact with",
    "value": "text to type (if applicable)",
    "reasoning": "why you're doing this"
  },
  "isKeyState": true/false,
  "progressAssessment": 0-100
}

Important rules:

1. Check if already logged in first
   - Linear: if you see sidebar, issues list, or team name → already logged in
   - Notion: if you see workspace, page list, or content area → already logged in
   - Asana: if you see sidebar, project list, or task list → already logged in
   - Don't click login buttons if you're already in the workspace
   - Only login if you see email input or explicit "Sign in" button

2. If you see "Authentication error" or "don't have access to this workspace"
   - Navigate to the base URL (linear.app, notion.so, etc.) so user can access their workspace

3. Target elements precisely
   - Use exact visible text: "New issue", "Save", "Submit"
   - For icon buttons: use aria-label like "Notifications" or "Settings"
   - For inputs: use placeholder text like "Issue title" or "Leave a comment..."
   - For issue IDs: just use the ID like "DEE-6" or "PROJ-12"
   - Elements in modals/dialogs take priority over main page elements

4. Action types
   - click: buttons, links, dropdowns, menus
   - type: text input (auto-submits for comments, titles, descriptions)
   - wait: give page time to load (use sparingly)
   - navigate: go to URL
   - complete: task is done (only when you can visually confirm)
   - scroll: scroll page (rarely needed)

5. The system auto-handles some things
   - Cmd+Enter after typing comments, issue titles, descriptions
   - Keyboard shortcuts like C for create, Cmd+K for search
   - Selecting menu options after dropdowns open

6. Know when to mark complete
   - Status change task: if status now shows the target value → done
   - Assignment task: if assignee field shows correct person → done
   - Creation task: if new item appears in list → done
   - Multi-step like "create and assign": both must be done before marking complete
   - Don't keep clicking if UI already updated successfully
   - Parse the task carefully - "create and assign" means 2 separate actions

7. Progress scale
   - 0-20: just started, navigating to workspace
   - 20-40: navigating to right place
   - 40-60: action initiated (modal opened, form visible)
   - 60-80: filling out form
   - 80-95: submitted, waiting for confirmation
   - 95-100: visually confirmed complete

Linear-specific patterns:

Create issue:
- Click "New issue" (or press C) → type title → auto-submits

Add description:
- Open issue → click "Add description..." → type → auto-saves

Add comment:
- Open issue → type in comment field → auto-submits

Change status (important):
- Status badges in list view are NOT clickable
- Click issue ID first to open detail page
- Then click Status dropdown on detail page
- Select new status from menu
- Don't use "Status badge of DEE-9" - that's not a real element
- Use "DEE-9" to open, then "Status" on detail page, then status name

Assign issue:
- Open issue detail page
- Click assignee field (shows "Unassigned" or current name)
- Select person from dropdown

If you're on an issue detail page (URL has /issue/):
- Do everything there, don't navigate back
- You can assign, change status, add comment, add description all from detail page

Examples:

{"stateDescription": "Linear workspace, 'New issue' button visible", "nextAction": {"type": "click", "target": "New issue", "reasoning": "Opening issue creation modal"}, "isKeyState": true, "progressAssessment": 25}

{"stateDescription": "Issue modal open, title field empty", "nextAction": {"type": "type", "target": "Issue title", "value": "Fix login bug", "reasoning": "Entering issue title"}, "isKeyState": true, "progressAssessment": 60}

{"stateDescription": "Issues list showing DEE-9", "nextAction": {"type": "click", "target": "DEE-9", "reasoning": "Opening issue to change status"}, "isKeyState": true, "progressAssessment": 40}

{"stateDescription": "Issue DEE-9 detail page, status shows 'Todo'", "nextAction": {"type": "click", "target": "Status", "reasoning": "Opening status dropdown"}, "isKeyState": true, "progressAssessment": 70}

{"stateDescription": "Status dropdown open", "nextAction": {"type": "click", "target": "In Progress", "reasoning": "Selecting target status"}, "isKeyState": true, "progressAssessment": 90}

{"stateDescription": "Issue DEE-9 now shows 'In Progress'", "nextAction": {"type": "complete", "target": "Task completed", "reasoning": "Status changed successfully"}, "isKeyState": true, "progressAssessment": 100}
`;

export const TASK_PLANNING_PROMPT = `
Analyze this task and plan out the steps needed.

TASK: {task}
APP: {appName}
BASE URL: {baseUrl}

Think about:
- Is user already logged in or do they need to login?
- What navigation is needed?
- What forms need to be filled?
- Are there multiple steps (like create then assign)?
- How will we know it's complete?

Return JSON:
{
  "taskName": "short_name",
  "estimatedSteps": <number>,
  "keyMilestones": ["milestone 1", "milestone 2", ...],
  "startingUrl": "where to start",
  "complexity": "low|medium|high",
  "notes": "anything important to know"
}

Step count guidelines:
- "Create issue" → about 3 steps (open modal, type, submit)
- "Create and assign" → about 5 steps (create flow + assign flow)
- "Change status" → about 4 steps (open issue, click dropdown, select, confirm)
- Most tasks: 2-8 steps total
- Complexity: low (1-3 steps), medium (4-7 steps), high (8+)

Examples:

{"taskName": "create_login_bug_issue", "estimatedSteps": 3, "keyMilestones": ["Open creation modal", "Enter title", "Confirm created"], "startingUrl": "https://linear.app", "complexity": "low", "notes": "Auto-submits with Cmd+Enter"}

{"taskName": "create_and_assign_docs_issue", "estimatedSteps": 5, "keyMilestones": ["Create issue", "Open created issue", "Assign to self", "Confirm"], "startingUrl": "https://linear.app", "complexity": "medium", "notes": "Two-part task"}

{"taskName": "change_dee9_status", "estimatedSteps": 4, "keyMilestones": ["Open DEE-9", "Click status", "Select In Progress", "Confirm"], "startingUrl": "https://linear.app", "complexity": "low", "notes": "Must open detail page first"}
`;
