# Resvu skills for Claude

Helpers that let Claude do Resvu work for you. Right now there is one: it builds a request form you can
load straight into the admin console — either from a form you already have, or from a description of the
one you want.

## Set it up once

In Claude Code, type these two lines:

```
/plugin marketplace add resvu/skills
/plugin install resvu@resvu-skills
```

Then turn on automatic updates, so you get improvements as we make them:

1. Type `/plugin`
2. Go to the **Marketplaces** tab
3. Select **resvu-skills**, then **Enable auto-update**

That's the whole setup. You won't need to do it again.

## Using it

**If you already have the form** — a spreadsheet, a Word document, a PDF, even a photo of a paper form —
hand it over and say what you want:

> Here's the pet application form our board signed off on — turn it into a Resvu workflow template.
> *(attach the spreadsheet)*

**If you don't, just describe it:**

> Set up a maintenance request form. Ask for the resident's name and unit, what's broken, how urgent it is,
> a photo, and whether we can enter while they're out. It should go New → Assigned → Scheduled → Done.

Either way, Claude works out which questions are text boxes, dropdowns, dates or file uploads, and builds
the file the admin console expects. When you've described the form rather than sent one, it will read the
whole thing back to you first — every question and its answer type — so you can correct it before anything
is built.

It will ask about anything you haven't made clear — most often the **statuses** a request moves through,
like *New → In review → Complete*, since people usually think of the questions but not the steps.

You'll get back a file. To load it:

1. Open the admin console and go to **Workflow → Templates**
2. Click **Import template**
3. Choose the file, then pick the communities it should apply to

Nothing is created until the file is accepted, so a failed import costs you nothing — you can fix it and
try again.

## Good to know

- **Check the result before you publish it.** Claude makes sensible guesses about question types, but the
  form is yours — read it over in the console and adjust anything that isn't right. This matters most when
  you described the form rather than sent one, since there's no document to check it against.
- **Tell it the statuses if you care about them.** Otherwise it falls back to a standard set and will say
  so.
- **Images and attachments don't carry across** between accounts, so add those in the console afterwards.

## Questions or problems

Open an issue on this repository, or ask whoever set Claude up for your team.

## Passing this on to someone

Everything a new person needs, ready to send:

```
Resvu has a Claude helper that builds request forms for you — either from a
form you already have, or from a description of the one you want.

To set it up, open Claude Code and type these two lines:

  /plugin marketplace add resvu/skills
  /plugin install resvu@resvu-skills

Then type /plugin, open the Marketplaces tab, select resvu-skills and choose
"Enable auto-update" so you get improvements automatically.

That's a one-off. After that, just send Claude your form and ask for a Resvu
workflow template — or describe the form you want, if you don't have one yet.
You'll get back a file to load under Workflow → Templates → Import template.
```
