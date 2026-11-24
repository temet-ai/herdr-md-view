import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import alerts from "markdown-it-github-alerts";
import frontMatter from "markdown-it-front-matter";
export function makeParser() {
  return new MarkdownIt({ html: false, linkify: true, typographer: false })
    .use(footnote).use(alerts).use(frontMatter, () => {});
}
