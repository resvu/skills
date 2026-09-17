# Resvu skills for Claude

Helpers that let Claude do Resvu work for you. Right now there is one: it turns a form you already have —
a spreadsheet, a Word document, a PDF — into a request form you can load straight into the admin console.

## Set it up once

In Claude Code, type these two lines:

```
/plugin marketplace add resvu/skills
/plugin install resvu@resvu-skills
```

That's the whole setup. You won't need to do it again.

## Using it

Give Claude your form and say what you want. For example:

> Here's the pet application form our board signed off on — turn it into a Resvu workflow template.
> *(attach the spreadsheet)*

Claude reads the form, works out which questions are text boxes, dropdowns, dates or file uploads, and
builds the file the admin console expects. It will ask you about anything the document doesn't make clear —
most often the **statuses** a request moves through, like *New → In review → Complete*, since most forms
list the questions but not the steps.

You'll get back a file. To load it:

1. Open the admin console and go to **Workflow → Templates**
2. Click **Import template**
3. Choose the file, then pick the communities it should apply to

Nothing is created until the file is accepted, so a failed import costs you nothing — you can fix it and
try again.

## Good to know

- **Check the result before you publish it.** Claude makes sensible guesses about question types, but the
  form is yours — read it over in the console and adjust anything that isn't right.
- **Tell it the statuses if you care about them.** Otherwise it falls back to a standard set and will say
  so.
- **Images and attachments don't carry across** between accounts, so add those in the console afterwards.

## Questions or problems

Open an issue on this repository, or ask whoever set Claude up for your team.
