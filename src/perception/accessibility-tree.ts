import { Page } from 'playwright';

interface AccessibilityNode {
  role: string;
  name: string;
  children: AccessibilityNode[];
}

export class AccessibilityTreeExtractor {
  constructor(private page: Page) {}

  async extract(): Promise<AccessibilityNode> {
    try {
      // PURE VANILLA JAVASCRIPT - No arrow functions, templates, or complex expressions
      const tree = await this.page.evaluate(function buildAccessibilityTree() {
        var rootNode = {
          role: 'document',
          name: 'page',
          children: [],
        };

        function walkDOM(element, parentNode) {
          if (!element) return;

          var nodeRole = element.getAttribute('role');
          if (!nodeRole) {
            nodeRole = element.tagName.toLowerCase();
          }

          var nodeText = element.textContent;
          if (!nodeText) {
            nodeText = '';
          } else {
            nodeText = nodeText.trim();
            if (nodeText.length > 100) {
              nodeText = nodeText.substring(0, 100);
            }
          }

          var ariaLabel = element.getAttribute('aria-label');
          if (!ariaLabel) {
            ariaLabel = '';
          }

          var nodeName = ariaLabel || nodeText || nodeRole;

          var node = {
            role: nodeRole,
            name: nodeName,
            children: [],
          };

          parentNode.children.push(node);

          // Only traverse interactive elements and containers
          var childElements = element.children;
          for (var i = 0; i < childElements.length; i++) {
            var child = childElements[i];
            var childRole = child.getAttribute('role');
            var childTag = child.tagName.toLowerCase();

            // Skip style/script/meta tags
            if (childTag === 'style' || childTag === 'script' || childTag === 'meta') {
              continue;
            }

            // Only traverse important elements
            var isInteractive =
              childTag === 'button' ||
              childTag === 'a' ||
              childTag === 'input' ||
              childTag === 'textarea' ||
              childTag === 'form' ||
              childTag === 'label' ||
              childRole === 'button' ||
              childRole === 'link' ||
              childRole === 'textbox' ||
              childRole === 'combobox' ||
              childRole === 'dialog' ||
              childRole === 'menuitem' ||
              child.getAttribute('contenteditable') === 'true';

            if (isInteractive) {
              walkDOM(child, node);
            }
          }
        }

        walkDOM(document.body, rootNode);
        return rootNode;
      });

      return tree;
    } catch (error) {
      console.warn('⚠️ Accessibility tree extraction failed:', error);
      return { role: 'document', name: 'page', children: [] };
    }
  }
}

