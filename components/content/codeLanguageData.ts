/**
 * Static knowledge for the compiler languages without a bundled language service: reserved words,
 * how declarations look, common standard-library entries with short docs, and snippets.
 */

export type SymbolKind = "function" | "class" | "type" | "variable" | "constant" | "namespace";

export interface DeclarationPattern {
  kind: SymbolKind;
  /** Global regex; the `name` group may list several names. `params` captures a parameter list. */
  pattern: RegExp;
  /** Separates several names inside the `name` group (default: commas). */
  split?: RegExp;
}

export interface LanguageData {
  /** Identifier characters, without the global flag. */
  identifier: RegExp;
  /** In `type name` parameter lists the name is the last identifier (C family), else the first. */
  nameLast?: boolean;
  /** Line prefixes that make a comment directly above a declaration its documentation. */
  docComment: RegExp;
  keywords: string;
  declarations: DeclarationPattern[];
  /** `name` or `module.member` → [signature, plain-language description]. */
  builtins: Record<string, readonly [string, string]>;
  /** [trigger, template with ${placeholders}, description]. */
  snippets: readonly (readonly [string, string, string])[];
}

const SLASH_DOCS = /^\s*(?:\/\/\/?|\/\*\*?|\*(?!\/))/;
const HASH_DOCS = /^\s*#(?![!\[]|include|define|import|pragma|if|endif|else)/;

const C_FAMILY_VARIABLE =
  /\b(?:(?:const|static|unsigned|signed|long|short|volatile|register|extern|inline)[ \t]+)*(?:int|char|float|double|long|short|bool|void|size_t|auto|string|std::\w+(?:<[^;()]*>)?|vector<[^;()]*>|map<[^;()]*>|[A-Z]\w*(?:<[^;()=]*>)?)[ \t*&]+(?<name>[A-Za-z_]\w*)(?:\[[^\]]*\])?(?=[ \t]*(?:[=;,:)\[{]|$))/gm;

const C_DATA: LanguageData = {
  identifier: /[A-Za-z_]\w*/,
  nameLast: true,
  docComment: SLASH_DOCS,
  keywords:
    "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL true false bool",
  declarations: [
    {
      kind: "function",
      pattern:
        /^[ \t]*(?:[\w:<>,*&~]+[ \t*&]+)+(?<name>[A-Za-z_~][\w:]*)[ \t]*\((?<params>[^;{)]*)\)[ \t]*(?:const[ \t]*)?(?:noexcept[ \t]*)?(?:\{|$)/gm,
    },
    { kind: "class", pattern: /\b(?:struct|class|enum(?:[ \t]+class)?|union)[ \t]+(?<name>[A-Za-z_]\w*)/g },
    { kind: "type", pattern: /\btypedef\b[^;]*?\b(?<name>[A-Za-z_]\w*)[ \t]*;/g },
    { kind: "constant", pattern: /^[ \t]*#[ \t]*define[ \t]+(?<name>\w+)/gm },
    { kind: "variable", pattern: C_FAMILY_VARIABLE },
  ],
  builtins: {
    printf: [
      "int printf(const char *format, ...)",
      "Prints formatted text to standard output. `%d` int, `%f` double, `%s` string, `%c` char.",
    ],
    scanf: [
      "int scanf(const char *format, ...)",
      'Reads formatted values from standard input into the given addresses, e.g. `scanf("%d", &n)`. Returns how many values were read.',
    ],
    puts: ["int puts(const char *s)", "Prints a string followed by a newline."],
    fgets: [
      "char *fgets(char *buffer, int size, FILE *stream)",
      "Reads one line (including the newline) of at most `size - 1` characters. Returns NULL at end of input.",
    ],
    getchar: ["int getchar(void)", "Reads the next character from standard input, or EOF."],
    malloc: ["void *malloc(size_t size)", "Allocates `size` bytes on the heap. Release them with `free`."],
    calloc: [
      "void *calloc(size_t count, size_t size)",
      "Allocates zero-filled memory for `count` items of `size` bytes.",
    ],
    free: ["void free(void *ptr)", "Releases memory obtained from malloc, calloc or realloc."],
    strlen: ["size_t strlen(const char *s)", "Returns the number of characters before the terminating `\\0`."],
    strcpy: ["char *strcpy(char *dest, const char *src)", "Copies `src` (with its terminator) into `dest`."],
    strcmp: [
      "int strcmp(const char *a, const char *b)",
      "Compares two strings: 0 when equal, negative or positive otherwise.",
    ],
    strcspn: [
      "size_t strcspn(const char *s, const char *reject)",
      "Length of the prefix of `s` containing none of `reject`; often used to strip the newline from fgets.",
    ],
    memset: ["void *memset(void *ptr, int value, size_t count)", "Fills `count` bytes of memory with `value`."],
    atoi: ["int atoi(const char *s)", "Converts the leading digits of a string to an int."],
    abs: ["int abs(int n)", "Absolute value of an integer."],
    sqrt: ["double sqrt(double x)", "Square root (needs <math.h>)."],
    pow: ["double pow(double base, double exponent)", "Raises `base` to `exponent` (needs <math.h>)."],
    stdin: ["FILE *stdin", "The standard input stream."],
    stdout: ["FILE *stdout", "The standard output stream."],
  },
  snippets: [
    ["main", "#include <stdio.h>\n\nint main(void) {\n\t${}\n\treturn 0;\n}", "Program entry point"],
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}", "Counted loop"],
    ["while", "while (${condition}) {\n\t${}\n}", "While loop"],
    ["if", "if (${condition}) {\n\t${}\n}", "If statement"],
    ["printf", 'printf("${%d}\\n", ${value});', "Formatted print"],
    ["struct", "struct ${Name} {\n\t${}\n};", "Structure"],
  ],
};

const CPP_DATA: LanguageData = {
  ...C_DATA,
  keywords: `${C_DATA.keywords} alignas alignof catch class constexpr const_cast decltype delete dynamic_cast explicit export friend mutable namespace new noexcept nullptr operator private protected public reinterpret_cast static_assert static_cast template this throw try typeid typename using virtual`,
  declarations: [
    ...C_DATA.declarations,
    { kind: "namespace", pattern: /\bnamespace[ \t]+(?<name>\w+)/g },
    { kind: "type", pattern: /\busing[ \t]+(?<name>\w+)[ \t]*=/g },
  ],
  builtins: {
    ...C_DATA.builtins,
    std: ["namespace std", "The C++ standard library namespace."],
    "std::cout": [
      "std::ostream std::cout",
      "Standard output stream. Write with `<<`, e.g. `std::cout << x << '\\n';`.",
    ],
    "std::cin": ["std::istream std::cin", "Standard input stream. Read with `>>`, e.g. `std::cin >> n;`."],
    "std::cerr": ["std::ostream std::cerr", "Unbuffered standard error stream."],
    "std::endl": ["std::endl", "Writes a newline and flushes the stream. Prefer `'\\n'` when flushing is not needed."],
    "std::getline": [
      "std::istream& std::getline(std::istream& in, std::string& line)",
      "Reads one whole line (without the newline) into `line`.",
    ],
    "std::string": [
      "class std::string",
      "A growable sequence of characters. `size()`, `substr()`, `find()`, `+` to concatenate.",
    ],
    "std::vector": [
      "template<class T> class std::vector",
      "A growable array. `push_back()`, `size()`, `[]`, `begin()/end()`.",
    ],
    "std::map": [
      "template<class K, class V> class std::map",
      "Sorted key-value map. Access with `m[key]`, iterate in key order.",
    ],
    "std::unordered_map": [
      "template<class K, class V> class std::unordered_map",
      "Hash map with average O(1) lookups.",
    ],
    "std::sort": [
      "void std::sort(RandomIt first, RandomIt last, Compare comp = {})",
      "Sorts a range in place, e.g. `std::sort(v.begin(), v.end());` (needs <algorithm>).",
    ],
    "std::max": ["const T& std::max(const T& a, const T& b)", "Returns the larger of two values."],
    "std::min": ["const T& std::min(const T& a, const T& b)", "Returns the smaller of two values."],
    "std::to_string": ["std::string std::to_string(T value)", "Converts a number to its decimal text."],
    "std::stoi": ["int std::stoi(const std::string& s)", "Parses an int from a string; throws on invalid input."],
    "std::make_unique": [
      "std::unique_ptr<T> std::make_unique<T>(Args&&... args)",
      "Creates an object owned by a unique_ptr.",
    ],
  },
  snippets: [
    ["main", "#include <iostream>\n\nint main() {\n\t${}\n\treturn 0;\n}", "Program entry point"],
    ["for", "for (int ${i} = 0; ${i} < ${n}; ++${i}) {\n\t${}\n}", "Counted loop"],
    ["forr", "for (const auto& ${item} : ${items}) {\n\t${}\n}", "Range-based for loop"],
    ["if", "if (${condition}) {\n\t${}\n}", "If statement"],
    ["cout", "std::cout << ${value} << '\\n';", "Print a line"],
    ["class", "class ${Name} {\npublic:\n\t${Name}() = default;\n\t${}\n};", "Class"],
  ],
};

const JAVA_LIKE_METHOD =
  /^[ \t]*(?:(?:public|private|protected|static|final|abstract|synchronized|native|override|virtual|async|internal|sealed|extern|unsafe|partial|default)[ \t]+)*(?:<[^>]+>[ \t]+)?[\w<>\[\],.?]+(?:[ \t]*<[^>]*>)?(?:\[\])*[ \t]+(?<name>[A-Za-z_]\w*)[ \t]*\((?<params>[^)]*)\)[ \t]*(?:throws[^{;]*)?(?:\{|$)/gm;
const JAVA_LIKE_VARIABLE =
  /\b(?:(?:final|const|readonly|static)[ \t]+)*(?:var|int|long|short|byte|char|float|double|boolean|bool|decimal|string|String|object|Object|[A-Z]\w*(?:<[^;()=]*>)?)(?:\[\])*\??[ \t]+(?<name>[A-Za-z_]\w*)(?=[ \t]*(?:[=;,:)]|in\b|$))/gm;

const JAVA_DATA: LanguageData = {
  identifier: /[A-Za-z_]\w*/,
  nameLast: true,
  docComment: SLASH_DOCS,
  keywords:
    "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public record return short static super switch synchronized this throw throws transient try var void volatile while true false yield",
  declarations: [
    { kind: "class", pattern: /\b(?:class|interface|enum|record)[ \t]+(?<name>[A-Za-z_]\w*)/g },
    { kind: "function", pattern: JAVA_LIKE_METHOD },
    { kind: "variable", pattern: JAVA_LIKE_VARIABLE },
  ],
  builtins: {
    System: ["final class java.lang.System", "Access to standard input, output and error, the clock and environment."],
    "System.out": ["PrintStream System.out", "Standard output stream."],
    "System.out.println": ["void println(Object x)", "Prints a value followed by a newline."],
    "System.out.print": ["void print(Object x)", "Prints a value without a newline."],
    "System.out.printf": [
      "PrintStream printf(String format, Object... args)",
      'Prints formatted text, e.g. `System.out.printf("%d items%n", n)`.',
    ],
    "System.in": ["InputStream System.in", "Standard input stream; wrap it in a Scanner or BufferedReader."],
    "System.currentTimeMillis": ["long currentTimeMillis()", "Milliseconds since 1970-01-01 UTC."],
    Scanner: ["class java.util.Scanner", "Reads typed tokens and lines, e.g. `new Scanner(System.in).nextLine()`."],
    String: [
      "final class java.lang.String",
      "Immutable text. `length()`, `charAt()`, `substring()`, `split()`, `equals()`.",
    ],
    "String.valueOf": ["static String valueOf(Object x)", "Converts any value to its text form."],
    "String.format": ["static String format(String format, Object... args)", "Builds a formatted string."],
    Integer: ["final class java.lang.Integer", "Boxed int with helpers like `Integer.parseInt`."],
    "Integer.parseInt": [
      "static int parseInt(String s)",
      "Parses a decimal integer; throws NumberFormatException on invalid text.",
    ],
    Math: ["final class java.lang.Math", "Numeric helpers: `max`, `min`, `abs`, `sqrt`, `pow`, `random`."],
    "Math.max": ["static int max(int a, int b)", "Returns the larger value."],
    "Math.min": ["static int min(int a, int b)", "Returns the smaller value."],
    "Math.abs": ["static int abs(int a)", "Absolute value."],
    "Math.sqrt": ["static double sqrt(double a)", "Square root."],
    "Math.pow": ["static double pow(double base, double exponent)", "Raises base to exponent."],
    ArrayList: ["class java.util.ArrayList<E>", "Resizable list. `add()`, `get(i)`, `size()`, `remove()`."],
    HashMap: ["class java.util.HashMap<K, V>", "Hash map. `put()`, `get()`, `getOrDefault()`, `containsKey()`."],
    Arrays: ["class java.util.Arrays", "Array helpers: `sort`, `toString`, `fill`, `asList`."],
    "Arrays.sort": ["static void sort(int[] a)", "Sorts an array in ascending order."],
    "Arrays.toString": ["static String toString(int[] a)", "Formats an array like `[1, 2, 3]`."],
    BufferedReader: [
      "class java.io.BufferedReader",
      "Fast line reader, e.g. `new BufferedReader(new InputStreamReader(System.in))`.",
    ],
  },
  snippets: [
    ["main", "public static void main(String[] args) {\n\t${}\n}", "Program entry point"],
    ["sout", "System.out.println(${});", "Print a line"],
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}", "Counted loop"],
    ["fore", "for (${var} ${item} : ${items}) {\n\t${}\n}", "For-each loop"],
    ["if", "if (${condition}) {\n\t${}\n}", "If statement"],
    ["try", "try {\n\t${}\n} catch (${Exception} e) {\n\te.printStackTrace();\n}", "Try/catch"],
  ],
};

const CSHARP_DATA: LanguageData = {
  ...JAVA_DATA,
  keywords:
    "abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield",
  declarations: [
    { kind: "class", pattern: /\b(?:class|interface|enum|record|struct)[ \t]+(?<name>[A-Za-z_]\w*)/g },
    { kind: "namespace", pattern: /\bnamespace[ \t]+(?<name>[\w.]+)/g },
    { kind: "function", pattern: JAVA_LIKE_METHOD },
    { kind: "variable", pattern: JAVA_LIKE_VARIABLE },
  ],
  builtins: {
    Console: ["static class System.Console", "Standard input and output for console apps."],
    "Console.WriteLine": [
      "void Console.WriteLine(object? value)",
      'Writes a value followed by a newline. Supports `$"{x}"` interpolation.',
    ],
    "Console.Write": ["void Console.Write(object? value)", "Writes a value without a newline."],
    "Console.ReadLine": ["string? Console.ReadLine()", "Reads the next line of input, or null at end of input."],
    "Console.Read": ["int Console.Read()", "Reads the next character code, or -1 at end of input."],
    "int.Parse": ["int int.Parse(string s)", "Parses an integer; throws FormatException on invalid text."],
    "int.TryParse": [
      "bool int.TryParse(string? s, out int result)",
      "Parses an integer without throwing; returns false on invalid text.",
    ],
    "string.Join": ["string string.Join(string separator, IEnumerable<T> values)", "Joins values with a separator."],
    "string.IsNullOrEmpty": ["bool string.IsNullOrEmpty(string? value)", 'True when the string is null or "".'],
    Math: ["static class System.Math", "Numeric helpers: `Max`, `Min`, `Abs`, `Sqrt`, `Pow`, `Round`."],
    "Math.Max": ["T Math.Max(T a, T b)", "Returns the larger value."],
    "Math.Min": ["T Math.Min(T a, T b)", "Returns the smaller value."],
    "Math.Sqrt": ["double Math.Sqrt(double d)", "Square root."],
    List: ["class List<T>", "Resizable list. `Add()`, `Count`, `[i]`, `Remove()`, LINQ methods."],
    Dictionary: ["class Dictionary<TKey, TValue>", "Hash map. `Add()`, `TryGetValue()`, `ContainsKey()`, `[key]`."],
  },
  snippets: [
    ["cw", "Console.WriteLine(${});", "Print a line"],
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++)\n{\n\t${}\n}", "Counted loop"],
    ["foreach", "foreach (var ${item} in ${items})\n{\n\t${}\n}", "For-each loop"],
    ["if", "if (${condition})\n{\n\t${}\n}", "If statement"],
    ["class", "class ${Name}\n{\n\t${}\n}", "Class"],
    ["main", "static void Main(string[] args)\n{\n\t${}\n}", "Program entry point"],
  ],
};

const PYTHON_DATA: LanguageData = {
  identifier: /[A-Za-z_]\w*/,
  docComment: HASH_DOCS,
  keywords:
    "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield self",
  declarations: [
    { kind: "function", pattern: /^[ \t]*(?:async[ \t]+)?def[ \t]+(?<name>\w+)[ \t]*\((?<params>[^)]*)\)/gm },
    { kind: "class", pattern: /^[ \t]*class[ \t]+(?<name>\w+)/gm },
    {
      kind: "variable",
      pattern: /^[ \t]*(?<name>[A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*(?::[^=\n]+)?=(?!=)/gm,
    },
    { kind: "variable", pattern: /\bfor[ \t]+(?<name>[\w, \t]+?)[ \t]+in\b/g },
    { kind: "variable", pattern: /\bas[ \t]+(?<name>\w+)/g },
    { kind: "namespace", pattern: /^[ \t]*import[ \t]+(?<name>[\w., \t]+)/gm },
    { kind: "namespace", pattern: /^[ \t]*from[ \t]+[\w.]+[ \t]+import[ \t]+(?<name>[\w, \t]+)/gm },
  ],
  builtins: {
    print: [
      "print(*values, sep=' ', end='\\n', file=sys.stdout)",
      "Prints values separated by `sep` and followed by `end`.",
    ],
    input: ["input(prompt='') -> str", "Reads one line from standard input without the trailing newline."],
    len: ["len(obj) -> int", "Number of items in a string, list, dict, set or tuple."],
    range: [
      "range(start=0, stop, step=1)",
      "Integers from `start` up to (not including) `stop`, e.g. `range(3)` → 0, 1, 2.",
    ],
    int: ["int(x=0, base=10) -> int", "Converts a number or numeric string to an integer."],
    float: ["float(x=0.0) -> float", "Converts a number or numeric string to a float."],
    str: ["str(object='') -> str", "Text form of a value."],
    list: ["list(iterable=()) -> list", "A mutable sequence. `append()`, `pop()`, `sort()`, slicing."],
    dict: ["dict(**kwargs) -> dict", "A key-value mapping. `get()`, `items()`, `keys()`, `values()`."],
    set: ["set(iterable=()) -> set", "An unordered collection of unique items."],
    tuple: ["tuple(iterable=()) -> tuple", "An immutable sequence."],
    enumerate: ["enumerate(iterable, start=0)", "Yields `(index, item)` pairs."],
    zip: ["zip(*iterables)", "Yields tuples pairing items from each iterable; stops at the shortest."],
    map: ["map(function, iterable)", "Applies a function to every item lazily."],
    filter: ["filter(function, iterable)", "Keeps items for which the function returns true."],
    sorted: ["sorted(iterable, *, key=None, reverse=False) -> list", "Returns a new sorted list."],
    sum: ["sum(iterable, start=0)", "Adds all items."],
    min: ["min(iterable, *, key=None)", "Smallest item."],
    max: ["max(iterable, *, key=None)", "Largest item."],
    abs: ["abs(x)", "Absolute value."],
    round: ["round(number, ndigits=None)", "Rounds to `ndigits` decimals (banker's rounding at .5)."],
    open: ["open(file, mode='r', encoding=None)", "Opens a file; use with `with open(...) as f:`."],
    isinstance: [
      "isinstance(obj, classinfo) -> bool",
      "True when `obj` is an instance of the class or tuple of classes.",
    ],
    sys: ["module sys", "Interpreter access: `sys.stdin`, `sys.argv`, `sys.exit()`."],
    "sys.stdin": [
      "sys.stdin: TextIO",
      "Standard input. `sys.stdin.readline()` reads one line, `sys.stdin.read()` everything.",
    ],
    "sys.stdin.readline": ["readline() -> str", "Reads one line including its newline; returns '' at end of input."],
    "sys.stdin.read": ["read() -> str", "Reads all remaining input."],
    "sys.argv": ["sys.argv: list[str]", "Command-line arguments; `sys.argv[0]` is the script name."],
    "sys.exit": ["sys.exit(status=0)", "Stops the program with an exit status."],
    math: ["module math", "Math functions: `sqrt`, `floor`, `ceil`, `pi`, `gcd`."],
    "math.sqrt": ["math.sqrt(x) -> float", "Square root."],
    "math.floor": ["math.floor(x) -> int", "Largest integer ≤ x."],
    "math.ceil": ["math.ceil(x) -> int", "Smallest integer ≥ x."],
    "math.gcd": ["math.gcd(*integers) -> int", "Greatest common divisor."],
    "math.pi": ["math.pi: float", "π ≈ 3.14159."],
  },
  snippets: [
    ["def", "def ${name}(${params}):\n\t${pass}", "Function"],
    ["for", "for ${item} in ${items}:\n\t${pass}", "For loop"],
    ["fori", "for ${i} in range(${n}):\n\t${pass}", "Counted loop"],
    ["if", "if ${condition}:\n\t${pass}", "If statement"],
    ["class", "class ${Name}:\n\tdef __init__(self${, params}):\n\t\t${pass}", "Class"],
    ["main", 'if __name__ == "__main__":\n\t${main()}', "Run when executed directly"],
    ["with", "with open(${path}) as ${f}:\n\t${pass}", "Open a file"],
  ],
};

const GO_DATA: LanguageData = {
  identifier: /[A-Za-z_]\w*/,
  docComment: SLASH_DOCS,
  keywords:
    "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota",
  declarations: [
    {
      kind: "function",
      pattern: /^func[ \t]+(?:\([^)]*\)[ \t]*)?(?<name>\w+)[ \t]*(?:\[[^\]]*\])?\((?<params>[^)]*)\)/gm,
    },
    { kind: "type", pattern: /\btype[ \t]+(?<name>\w+)/g },
    { kind: "variable", pattern: /\bvar[ \t]+(?<name>\w+(?:[ \t]*,[ \t]*\w+)*)/g },
    { kind: "constant", pattern: /\bconst[ \t]+(?<name>\w+)/g },
    { kind: "variable", pattern: /(?<name>\b[A-Za-z_]\w*(?:[ \t]*,[ \t]*[A-Za-z_]\w*)*)[ \t]*:=/g },
  ],
  builtins: {
    fmt: ["package fmt", "Formatted I/O: `Println`, `Printf`, `Sprintf`, `Scan`."],
    "fmt.Println": ["func Println(a ...any) (n int, err error)", "Prints values separated by spaces, then a newline."],
    "fmt.Printf": [
      "func Printf(format string, a ...any) (n int, err error)",
      "Prints formatted text: `%d` int, `%s` string, `%v` any value, `%.2f` float.",
    ],
    "fmt.Print": ["func Print(a ...any) (n int, err error)", "Prints values without a trailing newline."],
    "fmt.Sprintf": ["func Sprintf(format string, a ...any) string", "Returns formatted text instead of printing it."],
    "fmt.Scan": [
      "func Scan(a ...any) (n int, err error)",
      "Reads space-separated values into pointers, e.g. `fmt.Scan(&n)`.",
    ],
    "fmt.Scanln": ["func Scanln(a ...any) (n int, err error)", "Like Scan but stops at a newline."],
    "fmt.Errorf": ["func Errorf(format string, a ...any) error", "Creates an error with a formatted message."],
    bufio: ["package bufio", "Buffered I/O: `bufio.NewScanner(os.Stdin)` reads input line by line."],
    "bufio.NewScanner": [
      "func NewScanner(r io.Reader) *Scanner",
      "Creates a line scanner; loop with `for s.Scan() { s.Text() }`.",
    ],
    "bufio.NewReader": [
      "func NewReader(rd io.Reader) *Reader",
      "Creates a buffered reader; `ReadString('\\n')` reads a line.",
    ],
    os: ["package os", "Operating system access: `os.Stdin`, `os.Args`, `os.Exit`."],
    "os.Stdin": ["var Stdin *os.File", "Standard input."],
    "os.Args": ["var Args []string", "Command-line arguments; `os.Args[0]` is the program."],
    "os.Exit": ["func Exit(code int)", "Stops the program immediately with a status code."],
    strings: ["package strings", "String helpers: `Split`, `TrimSpace`, `Contains`, `Join`, `Fields`."],
    "strings.TrimSpace": ["func TrimSpace(s string) string", "Removes leading and trailing whitespace."],
    "strings.Split": ["func Split(s, sep string) []string", "Splits around each separator."],
    "strings.Fields": ["func Fields(s string) []string", "Splits around runs of whitespace."],
    "strings.Join": ["func Join(elems []string, sep string) string", "Joins strings with a separator."],
    "strings.Contains": ["func Contains(s, substr string) bool", "Reports whether substr is within s."],
    strconv: ["package strconv", "Conversions between strings and numbers."],
    "strconv.Atoi": ["func Atoi(s string) (int, error)", "Parses a decimal int, returning an error for invalid text."],
    "strconv.Itoa": ["func Itoa(i int) string", "Formats an int as decimal text."],
    len: ["func len(v Type) int", "Length of a string, slice, array, map or channel."],
    append: [
      "func append(slice []Type, elems ...Type) []Type",
      "Appends elements, growing the slice; always use the result.",
    ],
    make: [
      "func make(t Type, size ...IntegerType) Type",
      "Creates a slice, map or channel, e.g. `make([]int, 0, 10)`.",
    ],
  },
  snippets: [
    ["main", 'package main\n\nimport "fmt"\n\nfunc main() {\n\t${}\n}', "Program entry point"],
    ["func", "func ${name}(${params}) ${error} {\n\t${}\n}", "Function"],
    ["for", "for ${i} := 0; ${i} < ${n}; ${i}++ {\n\t${}\n}", "Counted loop"],
    ["forr", "for ${index}, ${value} := range ${items} {\n\t${}\n}", "Range loop"],
    ["iferr", "if err != nil {\n\t${return err}\n}", "Check an error"],
    ["pl", "fmt.Println(${})", "Print a line"],
  ],
};

const RUST_DATA: LanguageData = {
  identifier: /[A-Za-z_]\w*/,
  docComment: SLASH_DOCS,
  keywords:
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  declarations: [
    { kind: "function", pattern: /\bfn[ \t]+(?<name>\w+)[ \t]*(?:<[^>]*>)?[ \t]*\((?<params>[^)]*)\)/g },
    { kind: "class", pattern: /\b(?:struct|enum|trait|union)[ \t]+(?<name>\w+)/g },
    { kind: "type", pattern: /\btype[ \t]+(?<name>\w+)/g },
    { kind: "namespace", pattern: /\bmod[ \t]+(?<name>\w+)/g },
    { kind: "variable", pattern: /\blet[ \t]+(?:mut[ \t]+)?(?<name>\w+)/g },
    { kind: "constant", pattern: /\b(?:const|static)[ \t]+(?:mut[ \t]+)?(?<name>[A-Z_]\w*)/g },
    { kind: "variable", pattern: /\bfor[ \t]+(?<name>\w+)[ \t]+in\b/g },
  ],
  builtins: {
    println: [
      'println!("format", args...)',
      "Prints formatted text and a newline. `{}` displays a value, `{:?}` debug-prints it.",
    ],
    print: ['print!("format", args...)', "Prints formatted text without a newline."],
    eprintln: ['eprintln!("format", args...)', "Prints to standard error with a newline."],
    format: ['format!("format", args...) -> String', "Builds a String from a format string."],
    vec: ["vec![elements...]", "Creates a Vec, e.g. `vec![1, 2, 3]` or `vec![0; n]`."],
    panic: ['panic!("message")', "Aborts the current thread with an error message."],
    String: ["struct String", "Owned, growable UTF-8 text. `push_str()`, `len()`, `trim()`, `as_str()`."],
    "String::new": ["fn new() -> String", "Creates an empty String."],
    "String::from": ["fn from(s: &str) -> String", "Creates an owned String from a string slice."],
    Vec: ["struct Vec<T>", "Growable array. `push()`, `pop()`, `len()`, `iter()`."],
    "Vec::new": ["fn new() -> Vec<T>", "Creates an empty Vec."],
    "Vec::with_capacity": [
      "fn with_capacity(capacity: usize) -> Vec<T>",
      "Creates an empty Vec with room for `capacity` items.",
    ],
    Option: ["enum Option<T> { Some(T), None }", "A value that may be absent."],
    Some: ["Some(T)", "An Option holding a value."],
    None: ["None", "An Option with no value."],
    Result: ["enum Result<T, E> { Ok(T), Err(E) }", "Success value or error; propagate with `?`."],
    Ok: ["Ok(T)", "A successful Result."],
    Err: ["Err(E)", "A failed Result."],
    io: ["mod std::io", "Input and output: `io::stdin()`, `read_line`, `Write`."],
    "io::stdin": [
      "fn stdin() -> Stdin",
      "Handle to standard input; `io::stdin().read_line(&mut line)` reads one line.",
    ],
    "std::io": ["mod std::io", "Input and output: `io::stdin()`, `read_line`, `Write`."],
    HashMap: ["struct std::collections::HashMap<K, V>", "Hash map. `insert()`, `get()`, `entry().or_insert()`."],
  },
  snippets: [
    ["main", "fn main() {\n\t${}\n}", "Program entry point"],
    ["fn", "fn ${name}(${params}) -> ${()} {\n\t${}\n}", "Function"],
    ["for", "for ${item} in ${items} {\n\t${}\n}", "For loop"],
    ["match", "match ${value} {\n\t${pattern} => ${},\n\t_ => ${},\n}", "Match expression"],
    [
      "readline",
      'let mut ${line} = String::new();\nstd::io::stdin().read_line(&mut ${line}).expect("read input");',
      "Read one input line",
    ],
    ["struct", "struct ${Name} {\n\t${field}: ${Type},\n}", "Structure"],
  ],
};

const PHP_DATA: LanguageData = {
  identifier: /\$?[A-Za-z_]\w*/,
  docComment: /^\s*(?:\/\/\/?|\/\*\*?|\*(?!\/)|#(?!\[))/,
  keywords:
    "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new null or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false",
  declarations: [
    { kind: "function", pattern: /\bfunction[ \t]+&?(?<name>\w+)[ \t]*\((?<params>[^)]*)\)/g },
    { kind: "class", pattern: /\b(?:class|interface|trait|enum)[ \t]+(?<name>\w+)/g },
    { kind: "variable", pattern: /(?<name>\$\w+)[ \t]*(?:[.+\-*\/]|\?\?)?=(?![=>])/g },
    { kind: "variable", pattern: /\bas[ \t]+(?<name>\$\w+(?:[ \t]*=>[ \t]*\$\w+)?)/g, split: /,|=>/ },
    { kind: "constant", pattern: /\bconst[ \t]+(?<name>\w+)/g },
  ],
  builtins: {
    echo: ["echo string ...$values", "Outputs one or more strings."],
    printf: [
      "printf(string $format, mixed ...$values): int",
      "Prints formatted text: `%d` int, `%s` string, `%.2f` float.",
    ],
    sprintf: ["sprintf(string $format, mixed ...$values): string", "Returns formatted text."],
    fgets: [
      "fgets(resource $stream, ?int $length = null): string|false",
      "Reads one line, e.g. `fgets(STDIN)`; false at end of input.",
    ],
    trim: [
      'trim(string $string, string $characters = " \\n\\r\\t\\v\\0"): string',
      "Strips whitespace (or given characters) from both ends.",
    ],
    explode: [
      "explode(string $separator, string $string, int $limit = PHP_INT_MAX): array",
      "Splits a string into an array.",
    ],
    implode: ["implode(string $separator, array $array): string", "Joins array items with a separator."],
    strlen: ["strlen(string $string): int", "Length in bytes."],
    count: ["count(Countable|array $value): int", "Number of items in an array."],
    str_replace: [
      "str_replace(array|string $search, array|string $replace, string|array $subject): string|array",
      "Replaces all occurrences.",
    ],
    in_array: [
      "in_array(mixed $needle, array $haystack, bool $strict = false): bool",
      "Checks whether a value exists in an array.",
    ],
    array_map: [
      "array_map(?callable $callback, array $array, array ...$arrays): array",
      "Applies a callback to each item.",
    ],
    array_filter: [
      "array_filter(array $array, ?callable $callback = null): array",
      "Keeps items for which the callback returns true.",
    ],
    intval: ["intval(mixed $value, int $base = 10): int", "Converts a value to an integer."],
    var_dump: ["var_dump(mixed $value, mixed ...$values): void", "Prints a value's type and structure for debugging."],
    print_r: ["print_r(mixed $value, bool $return = false): string|bool", "Prints a human-readable representation."],
    STDIN: ["resource STDIN", "Standard input stream."],
  },
  snippets: [
    ["php", "<?php\n\n${}", "PHP open tag"],
    ["function", "function ${name}(${params}) {\n\t${}\n}", "Function"],
    ["foreach", "foreach (${$items} as ${$item}) {\n\t${}\n}", "For-each loop"],
    ["for", "for (${$i} = 0; ${$i} < ${$n}; ${$i}++) {\n\t${}\n}", "Counted loop"],
    ["if", "if (${condition}) {\n\t${}\n}", "If statement"],
    ["readline", "${$line} = trim(fgets(STDIN));", "Read one input line"],
  ],
};

const RUBY_DATA: LanguageData = {
  identifier: /[@$]{0,2}[A-Za-z_]\w*[?!]?/,
  docComment: HASH_DOCS,
  keywords:
    "BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
  declarations: [
    { kind: "function", pattern: /^[ \t]*def[ \t]+(?:self\.)?(?<name>[\w?!=]+)[ \t]*(?:\((?<params>[^)]*)\))?/gm },
    { kind: "class", pattern: /^[ \t]*(?:class|module)[ \t]+(?<name>[A-Z]\w*)/gm },
    { kind: "constant", pattern: /^[ \t]*(?<name>[A-Z][A-Z0-9_]*)[ \t]*=(?!=)/gm },
    {
      kind: "variable",
      pattern:
        /^[ \t]*(?<name>@{0,2}[a-z_]\w*(?:[ \t]*,[ \t]*@{0,2}[a-z_]\w*)*)[ \t]*(?:\|\||&&|[+\-*\/])?=(?![=~>])/gm,
    },
    { kind: "variable", pattern: /\|(?<name>[\w, \t*&]+)\|/g },
    { kind: "function", pattern: /\battr_(?:accessor|reader|writer)[ \t]+(?<name>[:\w, \t]+)/g },
  ],
  builtins: {
    puts: ["puts(*objects) -> nil", "Prints each value followed by a newline."],
    print: ["print(*objects) -> nil", "Prints values without a newline."],
    p: ["p(*objects) -> object", "Prints the inspected form of values, handy for debugging."],
    gets: ["gets -> String or nil", "Reads one line from standard input including the newline; nil at end of input."],
    require: ["require(name) -> true or false", "Loads a library such as `require 'set'`."],
    chomp: ["String#chomp -> String", "Removes a trailing newline, e.g. `gets.chomp`."],
    to_i: ["String#to_i -> Integer", "Converts leading digits to an Integer (0 when none)."],
    to_s: ["Object#to_s -> String", "Text form of a value."],
    split: ["String#split(pattern = nil) -> Array", "Splits text on whitespace or a pattern."],
    each: ["Enumerable#each { |item| ... }", "Calls the block once for each item."],
    map: ["Enumerable#map { |item| ... } -> Array", "Returns a new array with the block's results."],
    select: ["Enumerable#select { |item| ... } -> Array", "Keeps items for which the block is truthy."],
    STDIN: ["IO STDIN", "Standard input. `STDIN.read` reads everything, `STDIN.each_line` iterates."],
  },
  snippets: [
    ["def", "def ${name}(${params})\n\t${}\nend", "Method"],
    ["class", "class ${Name}\n\tdef initialize(${params})\n\t\t${}\n\tend\nend", "Class"],
    ["each", "${items}.each do |${item}|\n\t${}\nend", "Iterate items"],
    ["if", "if ${condition}\n\t${}\nend", "If statement"],
    ["readline", "${line} = gets&.chomp", "Read one input line"],
  ],
};

const KOTLIN_DATA: LanguageData = {
  identifier: /[A-Za-z_]\w*/,
  docComment: SLASH_DOCS,
  keywords:
    "abstract as break by catch class companion const constructor continue data do else enum false final finally for fun if import in init inline interface internal is lateinit null object open operator out override package private protected public return sealed super suspend this throw true try typealias val var vararg when where while",
  declarations: [
    { kind: "function", pattern: /\bfun[ \t]+(?:<[^>]+>[ \t]*)?(?:[\w.]+\.)?(?<name>\w+)[ \t]*\((?<params>[^)]*)\)/g },
    { kind: "class", pattern: /\b(?:class|object|interface)[ \t]+(?<name>\w+)/g },
    { kind: "type", pattern: /\btypealias[ \t]+(?<name>\w+)/g },
    { kind: "variable", pattern: /\b(?:val|var)[ \t]+(?<name>\w+)/g },
    { kind: "variable", pattern: /\bfor[ \t]*\([ \t]*(?<name>\w+)[ \t]+in\b/g },
  ],
  builtins: {
    println: [
      "fun println(message: Any?)",
      'Prints a value followed by a newline. Use `"$name"` or `"${expr}"` templates.',
    ],
    print: ["fun print(message: Any?)", "Prints a value without a newline."],
    readLine: ["fun readLine(): String?", "Reads one line from standard input; null at end of input."],
    readln: ["fun readln(): String", "Reads one line; throws at end of input."],
    listOf: ["fun <T> listOf(vararg elements: T): List<T>", "Creates a read-only list."],
    mutableListOf: ["fun <T> mutableListOf(vararg elements: T): MutableList<T>", "Creates a list you can add to."],
    mapOf: [
      "fun <K, V> mapOf(vararg pairs: Pair<K, V>): Map<K, V>",
      'Creates a read-only map, e.g. `mapOf("a" to 1)`.',
    ],
    mutableMapOf: [
      "fun <K, V> mutableMapOf(vararg pairs: Pair<K, V>): MutableMap<K, V>",
      "Creates a map you can change.",
    ],
    setOf: ["fun <T> setOf(vararg elements: T): Set<T>", "Creates a read-only set."],
    require: [
      "fun require(value: Boolean, lazyMessage: () -> Any)",
      "Throws IllegalArgumentException when the condition is false.",
    ],
    toInt: ["fun String.toInt(): Int", "Parses an Int; throws NumberFormatException on invalid text."],
    toIntOrNull: ["fun String.toIntOrNull(): Int?", "Parses an Int or returns null."],
  },
  snippets: [
    ["main", "fun main() {\n\t${}\n}", "Program entry point"],
    ["fun", "fun ${name}(${params}): ${Unit} {\n\t${}\n}", "Function"],
    ["for", "for (${item} in ${items}) {\n\t${}\n}", "For loop"],
    ["when", "when (${value}) {\n\t${pattern} -> ${}\n\telse -> ${}\n}", "When expression"],
    ["data", "data class ${Name}(val ${field}: ${Type})", "Data class"],
  ],
};

const BASH_DATA: LanguageData = {
  identifier: /\$?[A-Za-z_][\w-]*/,
  docComment: HASH_DOCS,
  keywords:
    "if then else elif fi for while until do done case esac in function select time return exit local export readonly declare",
  declarations: [
    { kind: "function", pattern: /^[ \t]*(?:function[ \t]+)?(?<name>[A-Za-z_][\w-]*)[ \t]*\(\)/gm },
    { kind: "function", pattern: /^[ \t]*function[ \t]+(?<name>[A-Za-z_][\w-]*)/gm },
    {
      kind: "variable",
      pattern: /^[ \t]*(?:(?:local|export|readonly|declare(?:[ \t]+-\w+)*)[ \t]+)?(?<name>[A-Za-z_]\w*)\+?=/gm,
    },
    { kind: "variable", pattern: /\bread(?:[ \t]+-\w+)*(?<name>(?:[ \t]+[A-Za-z_]\w*)+)/g, split: /\s+/ },
    { kind: "variable", pattern: /\bfor[ \t]+(?<name>\w+)[ \t]+in\b/g },
  ],
  builtins: {
    echo: [
      "echo [-n] [-e] [text ...]",
      "Prints its arguments followed by a newline (`-n` omits it, `-e` enables escapes).",
    ],
    printf: ["printf FORMAT [ARGUMENTS ...]", "Prints formatted text, e.g. `printf '%s\\n' \"$name\"`."],
    read: [
      "read [-r] [-p prompt] NAME ...",
      "Reads one input line into variables. Always use `-r` to keep backslashes.",
    ],
    test: ["test EXPRESSION  /  [ EXPRESSION ]", "Evaluates a condition: `-f file`, `-z str`, `a -eq b`."],
    cd: ["cd [DIR]", "Changes the working directory."],
    grep: ["grep [OPTIONS] PATTERN [FILE ...]", "Prints lines matching a pattern."],
    sed: ["sed [OPTIONS] SCRIPT [FILE ...]", "Stream editor, e.g. `sed 's/old/new/g'`."],
    awk: ["awk 'PROGRAM' [FILE ...]", "Pattern scanning, e.g. `awk '{print $1}'`."],
    cut: ["cut -d DELIM -f FIELDS", "Selects columns from each line."],
    sort: ["sort [OPTIONS] [FILE ...]", "Sorts lines (`-n` numeric, `-r` reverse)."],
    wc: ["wc [-l|-w|-c] [FILE ...]", "Counts lines, words or bytes."],
    exit: ["exit [N]", "Exits the script with status N."],
  },
  snippets: [
    ["if", "if [[ ${condition} ]]; then\n\t${}\nfi", "If statement"],
    ["for", "for ${item} in ${items}; do\n\t${}\ndone", "For loop"],
    ["while", "while IFS= read -r ${line}; do\n\t${}\ndone", "Read input line by line"],
    ["function", "${name}() {\n\t${}\n}", "Function"],
    ["case", "case ${value} in\n\t${pattern})\n\t\t${}\n\t\t;;\nesac", "Case statement"],
  ],
};

export const LANGUAGE_DATA: Partial<Record<string, LanguageData>> = {
  python: PYTHON_DATA,
  c: C_DATA,
  cpp: CPP_DATA,
  java: JAVA_DATA,
  csharp: CSHARP_DATA,
  kotlin: KOTLIN_DATA,
  go: GO_DATA,
  rust: RUST_DATA,
  php: PHP_DATA,
  ruby: RUBY_DATA,
  bash: BASH_DATA,
  sh: BASH_DATA,
  shell: BASH_DATA,
};
