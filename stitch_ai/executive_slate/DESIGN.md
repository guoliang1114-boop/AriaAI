# Design System Strategy: The Intelligent Workspace

## 1. Overview & Creative North Star
**Creative North Star: The Digital Architect**
This design system moves beyond the generic "SaaS dashboard" to create a bespoke, high-end environment tailored for the high-stakes world of elite consulting. The aesthetic is inspired by premium architectural drafting tools and editorial layouts—where precision meets clarity.

We reject "standard" UI tropes like heavy borders and generic shadows. Instead, we embrace **Tonal Precision**: a philosophy where hierarchy is established through meticulous shifts in surface color and calculated whitespace. The interface should feel like a custom-machined tool: restrained, authoritative, and profoundly efficient. By utilizing intentional asymmetry in the sidebar and high-density typography, we ensure the consultant feels in control of the AI, not overwhelmed by it.

---

## 2. Colors & Surface Philosophy
The palette is rooted in professional "Executive Blues" and "Gallery Grays."

*   **Primary (#003fb1 / #1a56db):** Reserved for moments of high intent—actionable buttons, active states, and critical paths.
*   **Surface Hierarchy (The "No-Line" Rule):** 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined through background shifts.
    *   **Base Layer:** `surface` (#f9f9fb) for the main canvas.
    *   **The Sidebar:** `surface_container_low` (#f3f3f5) provides a grounded starting point on the left.
    *   **The Cards:** `surface_container_lowest` (#ffffff) for active content modules, creating a natural lift.
*   **The Glass & Gradient Rule:** To maintain a macOS native feel, floating elements (like tooltips or detached search bars) should use `surface_container_lowest` at 85% opacity with a `20px` backdrop blur. Use a subtle linear gradient from `primary` to `primary_container` for the "New Project" or "Run AI" buttons to provide a "jewel-like" depth.

---

## 3. Typography
Typography is our primary tool for information density. We utilize **SF Pro Text** for its mathematical legibility and **PingFang SC** for its clean, balanced stroke weight in Chinese characters.

*   **Display & Headline (Display-LG to Headline-SM):** Set with tight letter-spacing (-0.02em). These are for high-level "Workstream" titles.
*   **Title-MD/SM:** Use `title-sm` (1rem) for Skill Card headings. Bold weight is required to anchor the eye.
*   **Body-MD:** The workhorse for AI-generated insights. Ensure a line height of 1.5x for sustained reading.
*   **Label-SM:** Use for metadata and "Quick Tool" tags. These should be all-caps in English to create an "archival" or "classified" feel.

---

## 4. Elevation & Depth
We eschew traditional drop shadows for **Tonal Layering**.

*   **The Layering Principle:** A "Deep Task" card (`surface_container_lowest`) sits on the main workbench (`surface`). The 2px difference in hex value provides a sophisticated, "flat-depth" look that is easier on the eyes during 10-hour workdays.
*   **Ambient Shadows:** For modal overlays or active search results, use a shadow with a 40px blur at 6% opacity, tinted with `primary` (#003fb1) rather than black. This mimics natural light refracting through glass.
*   **The Ghost Border:** For accessibility in Skill Cards, use the `outline_variant` token at 15% opacity. It should be felt, not seen.

---

## 5. Components

### Side Navigation (220px)
*   **Structure:** Use `surface_container_low`. No border on the right; use a subtle `surface_dim` vertical strip (1px) if the background matches exactly.
*   **Active State:** Use a "pill" shape with `primary_fixed` background and `on_primary_fixed` text.

### Skill Cards ('Quick Tool' vs 'Deep Task')
*   **Constraint:** No dividers. Use `spacing-4` (0.9rem) for internal padding.
*   **Quick Tool Tag:** `secondary_container` background with `on_secondary_container` text.
*   **Deep Task Tag:** `primary_fixed` background with `on_primary_fixed` text.
*   **Interaction:** On hover, shift background from `surface_container_lowest` to `surface_bright`.

### Chat Bubbles & AI Output
*   **User Input:** Right-aligned, `surface_container_high` (#e8e8ea), no tail, `radius-lg` (0.5rem).
*   **AI Response:** Left-aligned, no container. Use the `primary` color for the AI icon and a slight indentation. Use `body-md` for text.

### Search Bars
*   **Style:** `surface_container_highest` background, `radius-md`. 
*   **Focus State:** A 2px `primary` outer glow (8% opacity) rather than a hard stroke.

### Structured Data Lists
*   **Constraint:** Forbid divider lines. Use alternating row colors (`surface` and `surface_container_low`) or simply `spacing-2` of vertical white space to separate line items.
*   **Header:** Use `label-md` in `on_surface_variant` for column titles.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use `spacing-12` and `spacing-16` for major section breathing room to maintain the "Editorial" feel.
*   **Do** use `surface_container_lowest` for anything the user can interact with directly (The "Interactive Paper" rule).
*   **Do** ensure all AI-generated text uses `body-md` for maximum readability.

### Don’t
*   **Don’t** use black (#000000) for text. Always use `on_surface` (#1a1c1d) to reduce eye strain.
*   **Don’t** use standard 1px borders to separate the sidebar from the main content; let the color block of `surface_container_low` define the edge.
*   **Don’t** use vibrant accent colors outside of the defined palette; the workbench must remain a "neutral container" for the consultant's complex data.