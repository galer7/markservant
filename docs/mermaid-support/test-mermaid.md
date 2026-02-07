# Mermaid Test Document

This file tests Mermaid diagram rendering.

## Flowchart

```mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do something]
    B -->|No| D[Do something else]
    C --> E[End]
    D --> E
```

## Sequence Diagram

```mermaid
sequenceDiagram
    Alice->>Bob: Hello Bob
    Bob-->>Alice: Hi Alice
```

## Class Diagram

```mermaid
classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal: +int age
    Animal: +String gender
```

## Regular Code Block (should still highlight)

```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}
```

## Invalid Mermaid (should show error)

```mermaid
this is invalid syntax
```
