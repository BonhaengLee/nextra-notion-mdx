import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path, { dirname } from "path";
import { NotionToMarkdown } from "notion-to-md";
import { Client } from "@notionhq/client";
import { fileURLToPath } from "url";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const n2m = new NotionToMarkdown({ notionClient: notion });

async function fetchPages() {
  return notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: "Status",
      status: {
        equals: "Published",
      },
    },
  });
}

async function fetchPagesWithStatus(status) {
  return notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: "Status",
      status: {
        equals: status,
      },
    },
  });
}

async function fetchPageBlocks(pageId) {
  const response = await notion.blocks.children.list({ block_id: pageId });
  return response.results;
}

function getSlugParts(slug) {
  return slug.split("/");
}

async function getFolderPath(page, __dirname, slug) {
  const slugParts = getSlugParts(slug);

  let folderPath;
  const tabName = page.properties["Tab"]?.["select"]?.["name"] ?? null;
  if (tabName) {
    const subpathOfTab = slugParts.slice(0, -1);
    folderPath = path.join(__dirname, "../pages", tabName, ...subpathOfTab);
  } else {
    folderPath = path.join(__dirname, "../pages");
  }
  await fs.promises.mkdir(folderPath, { recursive: true });

  return [folderPath, slugParts[slugParts.length - 1]];
}

async function writeMetaJsonFile(folderPath, originFileName, plainText) {
  try {
    const filePath = path.join(`${folderPath}/${originFileName}`, "_meta.json");

    // 파일이 존재하는 경우 먼저 삭제
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }

    let parsedData;
    try {
      parsedData = JSON.parse(plainText);
    } catch (e) {
      console.error(`Failed to parse JSON: ${e.message}`);
      console.error(`Invalid JSON: ${plainText}`);
      return; // or throw e; depending on how you want to handle the error
    }

    const formattedJson = JSON.stringify(parsedData, null, 2);
    await fs.promises.writeFile(filePath, formattedJson);
  } catch (error) {
    console.error(`Failed to write _meta.json file:`, error);
  }
}

async function writeMarkdownFile(
  folderPath,
  originFileName,
  pageTitle,
  markdownString
) {
  try {
    const markdownTitle = `# ${pageTitle}\n\n`;
    const fullMarkdownContent = markdownTitle + markdownString.parent;
    const mdxFileName = `${originFileName}.mdx`;
    await fs.promises.writeFile(
      path.join(folderPath, mdxFileName),
      fullMarkdownContent
    );
  } catch (error) {
    console.error(`Failed to write .mdx file:`, error);
  }
}

async function processPages(status, __dirname) {
  const pages = await fetchPagesWithStatus(status);
  const pageResults = Object.entries(pages.results);

  const pagePromises = pageResults.map(async ([idx, page]) => {
    console.time(`${status}PagePromises-${idx}`);

    try {
      const blocks = await fetchPageBlocks(page.id);
      if (!blocks[0]?.code?.rich_text) {
        console.error(`Invalid data structure for ${status}Page ${idx}`);
        return;
      }

      const plainText = blocks[0].code.rich_text[0].plain_text;
      const slug = page.properties["Slug"]?.url;
      if (!slug) {
        throw new Error(
          `${status}Page ${page.id} does not have a Slug property`
        );
      }

      const [folderPath, originFileName] = await getFolderPath(
        page,
        __dirname,
        slug
      );
      await writeMetaJsonFile(folderPath, originFileName, plainText);
      console.timeEnd(`${status}PagePromises-${idx}`);
    } catch (error) {
      console.error(`Failed to process ${status}Page ${idx}:`, error);
    }
  });

  await Promise.all(pagePromises);
}

async function updateContent() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  await processPages("Index", __dirname);
  await processPages("Tab", __dirname);

  // Convert Pages
  const pages = await fetchPages();
  const pageResults = Object.entries(pages.results);

  const pagePromises = pageResults.map(([index, page]) => {
    return fetchPageBlocks(page.id)
      .then(blocks => n2m.blocksToMarkdown(blocks))
      .then(markdownObjects => n2m.toMarkdownString(markdownObjects))
      .then(async markdownString => {
        console.time(`pagePromises-${index}`);

        const slug = page.properties["Slug"]?.["url"];
        const isSlug = !!slug;
        if (!isSlug) {
          throw new Error(`Page ${page.id} does not have a Slug property`);
        }

        const pageTitle =
          page.properties["Title"]?.["title"]?.[0]?.["plain_text"];
        const isPageTitle = !!pageTitle;
        if (!isPageTitle) {
          throw new Error(`Page ${page.id} does not have a pageTitle property`);
        }

        const [folderPath, originFileName] = await getFolderPath(
          page,
          __dirname,
          slug
        );

        await writeMarkdownFile(
          folderPath,
          originFileName,
          pageTitle,
          markdownString
        );
        console.timeEnd(`pagePromises-${index}`);
      });
  });

  await Promise.all(pagePromises);
}
console.time("updateContent");
await updateContent();
console.timeEnd("updateContent");
