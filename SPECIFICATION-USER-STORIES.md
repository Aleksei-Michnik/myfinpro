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
- As a user, when a receipt is processed, the system extracts the place (merchant), date/time, and every line item with its name, quantity, applied discounts, and price, so that I don't type anything manually.
- As a user, extracted receipt items are automatically classified into my existing expense categories, and I can correct the classification during review.
- As a user, after a receipt is extracted I am guided through each line item, and the system offers me similar existing products (including matches across different names or languages for the same product), so that my purchase history stays consistent.
- As a user, I can confirm a proposed product match, pick a different product, or create a new product during the item walkthrough; my confirmations teach the system for next time.

#### Product Catalog

- As a user, purchases from my receipts build a product database automatically — new products/services appearing in receipts are added without manual work.
- As a user, the same product bought under different names or in different languages is recognized as one product via its aliases.
- As a user, I can scan a product's barcode with my device camera so that the barcode becomes the product's main identifier and future matches are exact.
- As a user, I can add one picture per product — uploaded in the background — either manually or as part of confirming a product, so that products are easy to recognize.
- As a user, when I scan an unknown barcode, the system prefills the product's name, brand, and image from an open product database (e.g. Open Food Facts) when available.
- As a user, I can browse and search my product catalog and see each product's aliases, barcode, image, and purchase history.

#### Purchase Analytics

- As a user, I can view places/stores where I made purchases organized by categories and names so that I can understand my shopping patterns.
- As a user, I can view a list of goods I've purchased so that I can track what I buy.
- As a user, I can see price dynamics (price history over time) for goods I've purchased multiple times so that I can track price changes and trends in general or by stores.
- As a user, I can see where I or my groups (family etc.) buy and how much is spent per category, item, or place — composing configurable combinations of dimensions and filter conditions — and save these views for reuse.

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
- As a user, I can connect my AI assistant to the app via a secure, user-scoped MCP connection (OAuth consent) and revoke that connection at any time from settings.
- As a user, my AI assistant can read my purchase history and habit summaries (e.g. what I buy weekly or monthly) so that it understands my habits and gives quality advice.
- As a user, I can upload receipts through my AI assistant's chat interface (photo or URL), and they enter the same extraction and review pipeline — the app acts as the database layer while the chat is my UI.
- As a user, my AI assistant can walk me through product match confirmations conversationally, so that receipts added via chat end up fully classified.
- As a user, I (and my assistant) can add and read comments on individual purchases so that the context of a purchase is remembered and available when needed.

## WebMCP User (In-Browser Agents)

- As a user with a browser-based AI agent, the web app exposes its actions (search purchases, view stats, add expenses, upload receipts, confirm product matches) as WebMCP tools, so that agents interact with the app directly instead of simulating clicks.
- As a user, any write action performed by an in-browser agent requires my explicit confirmation in the app UI.
