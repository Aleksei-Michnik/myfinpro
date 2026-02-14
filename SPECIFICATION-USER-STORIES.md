# User Stories / Use Cases

## Personal User

- As a personal user, I can create a dashboard for myself and see monthly income, spending, and targets progress.
- As a personal user, I can define custom income types and categorize incomes as one-time, limited period, or regular.
- As a personal user, I can set reminders for due payments and low balance alerts.
- As a personal user, I can create spending targets with a name, amount, and timeframe, and track progress.

### Personal Expense Tracking

#### Expense Entry Interface

- As a personal user, I can add information about my purchases and expenses via a simple interface so that I can easily track my spending.
- As a user, I can have the system automatically categorize my purchases and expenses so that I don't have to manually categorize each transaction.

#### Multi-Channel Access

- As a user, I can add expenses via the web app interface so that I can track spending from my computer.
- As a user, I can add expenses via Telegram bot UI (conversational or via menu and buttons) so that I can track spending through chat commands.
- As a user, I can add expenses via Telegram mini app so that I can track spending with a rich mobile interface.
- As a user, I can use LLM to ask questions about my finances and receive personalized insights based on my budget data.

#### Expense Classification

- As a user, I can select whether an expense is personal, or group/family when adding a purchase so that I can properly allocate and track different types of expenses. Should be all the groups and families which I am a part of selected by default. and remember the last choice.

#### Receipt Processing

- As a user, I can upload a photo of a receipt so that the system can automatically extract expense information from it.
- As a user, I can upload a PDF of a receipt so that the system can automatically extract expense information from it.
- As a user, I can add a URL to an online receipt so that the system can automatically extract expense information from it.
- As a user, I can send a receipt photo via Telegram bot so that I can quickly add expenses while on the go.

#### Purchase Analytics

- As a user, I can view places/stores where I made purchases organized by categories and names so that I can understand my shopping patterns.
- As a user, I can view a list of goods I've purchased so that I can track what I buy.
- As a user, I can see price dynamics (price history over time) for goods I've purchased multiple times so that I can track price changes and trends in general or by stores.

## Family/Group Owner/Admin (a family is a type of a group entity)

- As a group owner, I can invite other people to join my group entity and share a budget dashboard.
- As a group owner, I can assign budgets and targets scoped to the group and track progress.

## Group Member

- As a group member, I can track all expenses and incomes of the group via the web app so that I can monitor the group budget.
- As a group member, I can track all expenses and incomes of the group via the Telegram bot so that I can monitor the group budget on the go.
- As a group member, I can see which group member each expense or income is related to (on behalf of whom the expense/income was done) so that I can understand individual contributions.
- As a group member, I can view expenses and incomes of each group member separately so that I can analyze individual spending patterns.

## Web app user

- As a web app user, I can switch between dark and light themes so that I can customize the app's appearance to my preference.
- As a web app user, I can view analytics and reports for my personal finances so that I can analyze my spending patterns.
- As a web app user, I can view analytics and reports for my groups/families so that I can analyze shared finances.
- As a web app user, I can see which group/family member each expense or income is related to so that I can track individual contributions.
- As a web app user, I can see and manage individual or group/family expenses and incomes in a table veiw, where I can see, edit, add, or delete each expense/income and its details, including the group/family member it's related to, documents such as scaned receipts, date/time of operation, a member it's on behalf of, and other details.
- As a web app user, I can add notes to expenses/incomes. Notes may include tags/hashtags, mentions of other users, mentions of other expences/incomes, pictures, and support markdown semantic.
- As a web app user, I can set up notifications via email, Telegram, or web push notifications:
  - Notifications about due payments.
  - Notifications about low balances.
  - Notifications of target progress to low or gone backwards.

## Telegram User

- As a Telegram user, I can check balances and reminders through a bot with buttons and dialogs.
- As a Telegram user, I can open the mini app to manage budgets and targets on mobile.
- As a Telegram user, I can receive notifications about due payments and low balances.
- As a Telegram user, I can add purchases and expenses via the bot UI (conversational) so that I can track spending through chat commands.
- As a Telegram user, I can add purchases and expenses via the mini app so that I can track spending with a rich mobile interface.
- As a Telegram user, I can send a receipt photo via the bot so that I can quickly add expenses while on the go.
- As a Telegram user, I can add a note to an expense/income via the bot or mini app so that I can add additional context or details. It should support markdown semantic, pictures, mentions of other users, mentions of other expences/incomes, and hashtags.

### Group/Family Management via Telegram

- As a Telegram user, I can view group/family expenses and incomes via the bot so that I can monitor shared budgets on the go.
- As a Telegram user, I can view group/family expenses and incomes via the mini app so that I can manage shared budgets with a rich mobile interface.
- As a Telegram user, I can view analytics and reports for my groups/families via the bot so that I can understand shared spending patterns.
- As a Telegram user, I can view analytics and reports for my groups/families via the mini app so that I can analyze shared finances in detail.
- As a Telegram user, I can see which group/family member each expense or income is related to via the bot or mini app so that I can track individual contributions.

## LLM-Assisted User

- As a user, I can ask an AI assistant questions about my personal finances and receive personalized insights based on my budget data.
- As a user, I can ask the AI assistant questions about my family/group finances and receive insights about shared budgets, expenses, and spending patterns.
- As a user, I can ask the AI assistant for details about individual family/group member contributions and expenses.
- As a user, I can ask the AI assistant for advice on budgeting, saving, or managing expenses based on my financial data and targets.
- As a user, I want to have an MCP that I can access from my preferred AI assistant (e.g., ChatGPT, Claude, etc.) so that I can manage my finances directly from the assistant. I should have an ability to ask questions, add or remove expenses, incomes, budgets, and targets.
