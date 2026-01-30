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
- As a user, I can select whether an expense is personal, or group/family when adding a purchase so that I can properly allocate and track different types of expenses. Should be all the  groups and families which I am a part of selected by default. and remember the last choice.

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

## Telegram User
- As a Telegram user, I can check balances and reminders through a bot with buttons and dialogs.
- As a Telegram user, I can open the mini app to manage budgets and targets on mobile.
- As a Telegram user, I can receive notifications about due payments and low balances.
- As a Telegram user, I can add purchases and expenses via the bot UI (conversational) so that I can track spending through chat commands.
- As a Telegram user, I can add purchases and expenses via the mini app so that I can track spending with a rich mobile interface.
- As a Telegram user, I can send a receipt photo via the bot so that I can quickly add expenses while on the go.

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