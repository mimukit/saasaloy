// The announcement bar above the header on every page: a newly published module, a release,
// or other project news. An empty `message` hides the bar, so a build with nothing to say
// ships no bar at all. `link` is optional: an empty label or href drops it. A link that
// leaves the site opens in a new tab. The bar is static, so a change ships with the next
// release deploy (packages/cli/.release-it.js).

export const announcement: {
  message: string;
  link: { label: string; href: string };
} = {
  message: "",
  link: { label: "", href: "" },
};
