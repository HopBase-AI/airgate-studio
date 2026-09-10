package studio

// 2026-09-10：一位西语客户在网关上收到了中文报错。创作工作坊同样是多语言产品，凡是能到达
// 终端用户的字符串（writeJSON 响应体的 error/message 字段、任务失败文案、以及会被
// err.Error() 回放进上述位置的 fmt.Errorf/errors.New 文案）一律必须是英文；能按机器码
// 本地化的走前端插件自带五语字典（web/src/studio/video/failureHints.ts → VIDEO_STRINGS）。
//
// 本测试用 go/ast 扫描包内所有非测试源文件，四种形态任意一种带汉字即失败：
//  (i)   汉字字面量作为客户可见 emitter 的实参（含嵌套 fmt.Sprintf 与字符串拼接）；
//  (ii)  复合字面量里 error/message/Message/msg/reason/Reason/TerminalMessage 字段带汉字；
//  (iii) 汉字被赋给 msg/message/reason/text 变量，或赋给任何随后被传进 emitter 的常量/变量；
//  (iv)  已英文化文件里的 fmt.Errorf / errors.New 带汉字。
//
// 明确豁免（只面向运营/管理员，或本就不是回给客户的报错文案）：
//   - metadata.go 整个文件 + buildPluginInfo：后台插件配置表单的 name/Label/Description，
//     以及插件展示名，只在控制台插件管理里出现；
//   - plugin.go 的 slog 日志（Init/Start/Stop）与全部 Go 注释；
//   - skills.go 的 rewritePromptSystem / captionImageInstruction：发给模型的系统提示词，
//     是刻意调过的 prompt，不是回给用户的文案；
//   - service.go 的 defaultProjectName（"未命名项目"）与 db.go 建表语句里的同名 DEFAULT：
//     那是存量数据的字面值，展示层已在 web/src/studio/ProjectSidebar.tsx 按界面语言映射成
//     Untitled project，改后端反而会让新旧项目名分叉；
//   - inspirations.go 的内置灵感库目录（标题/描述/提示词/标签）：那是内容资产不是报错文案，
//     该文件里的 fmt.Errorf/errors.New 仍在本测试的检查范围内。

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

// clientFacingCalls：这些函数的任何字符串字面量实参都会直接进入客户可见文本。
var clientFacingCalls = map[string]bool{
	"writeJSON": true,
	"w.Write":   true,
}

// clientFacingFields：复合字面量里这些字段承载的是客户可见文案。
var clientFacingFields = map[string]bool{
	"error":           true,
	"Error":           true,
	"message":         true,
	"Message":         true,
	"msg":             true,
	"reason":          true,
	"Reason":          true,
	"TerminalMessage": true,
	"error_message":   true,
	"ErrorMessage":    true,
}

// clientFacingVarNames：这些名字的变量/常量一旦带汉字，几乎必然被喂给 emitter。
var clientFacingVarNames = map[string]bool{
	"msg":     true,
	"message": true,
	"reason":  true,
	"text":    true,
}

// errorConstructorFiles：这些文件里的 fmt.Errorf / errors.New 文案最终经 err.Error()
// 回放进 writeJSON(map{"error": ...})，因此同样禁止汉字。
var errorConstructorFiles = map[string]bool{
	"assets.go":       true,
	"generation.go":   true,
	"groups.go":       true,
	"host_api.go":     true,
	"inspirations.go": true,
	"projects.go":     true,
	"routes.go":       true,
	"service.go":      true,
	"skills.go":       true,
}

// adminOnlyFiles / isAdminOnlyFunc：只面向后台管理员的文案，不经 API 回放给终端用户。
var adminOnlyFiles = map[string]bool{
	"metadata.go": true,
}

func isAdminOnlyFunc(name string) bool {
	return name == "buildPluginInfo"
}

// allowedHanIdents：明确豁免的汉字常量（见文件头注释）。
var allowedHanIdents = map[string]bool{
	"defaultProjectName":      true,
	"rewritePromptSystem":     true,
	"captionImageInstruction": true,
}

func containsHan(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func TestClientFacingStringsMustBeEnglish(t *testing.T) {
	fset := token.NewFileSet()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	var violations []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		if adminOnlyFiles[name] {
			continue
		}
		file, err := parser.ParseFile(fset, filepath.Join(".", name), nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		violations = append(violations, scanFileForHan(fset, name, file)...)
	}
	if len(violations) > 0 {
		t.Fatalf("client-facing strings must be English (localize by failure code in web/src/studio/video/failureHints.ts):\n  %s",
			strings.Join(violations, "\n  "))
	}
}

func scanFileForHan(fset *token.FileSet, name string, file *ast.File) []string {
	var violations []string
	report := func(node ast.Node, why string) {
		violations = append(violations, fset.Position(node.Pos()).String()+": "+why)
	}

	// 第一遍：收集"值里带汉字"的标识符（const/var），用于形态 (iii) 的数据流判定。
	hanIdents := collectHanIdents(file)

	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && isAdminOnlyFunc(fn.Name.Name) {
			continue
		}
		ast.Inspect(decl, func(n ast.Node) bool {
			switch node := n.(type) {
			case *ast.CallExpr:
				callee := calleeName(node.Fun)
				isErrorCtor := errorConstructorFiles[name] && (callee == "fmt.Errorf" || callee == "errors.New")
				if !clientFacingCalls[callee] && !isErrorCtor {
					return true
				}
				for _, arg := range node.Args {
					// (i)/(iv) 直接字面量（含嵌套 Sprintf 与 a + b 拼接）。
					for _, lit := range stringLiterals(arg) {
						if containsHan(lit.value) {
							report(lit.node, "Han text passed to "+callee+": "+strconv.Quote(lit.value))
						}
					}
					// (iii) 传进 emitter 的标识符，其声明值带汉字。
					for _, id := range identifiers(arg) {
						if hanIdents[id.Name] && !allowedHanIdents[id.Name] {
							report(id, "Han-valued identifier "+id.Name+" passed to "+callee)
						}
					}
				}
			case *ast.KeyValueExpr:
				key := keyName(node.Key)
				if !clientFacingFields[key] {
					return true
				}
				for _, lit := range stringLiterals(node.Value) {
					if containsHan(lit.value) {
						report(lit.node, "Han text in field "+key+": "+strconv.Quote(lit.value))
					}
				}
			case *ast.AssignStmt:
				// (iii) 汉字赋给 msg/message/reason/text。
				for i, lhs := range node.Lhs {
					id, ok := lhs.(*ast.Ident)
					if !ok || !clientFacingVarNames[id.Name] || i >= len(node.Rhs) {
						continue
					}
					for _, lit := range stringLiterals(node.Rhs[i]) {
						if containsHan(lit.value) {
							report(lit.node, "Han text assigned to "+id.Name+": "+strconv.Quote(lit.value))
						}
					}
				}
			case *ast.ValueSpec:
				for i, id := range node.Names {
					if !clientFacingVarNames[id.Name] || i >= len(node.Values) {
						continue
					}
					for _, lit := range stringLiterals(node.Values[i]) {
						if containsHan(lit.value) {
							report(lit.node, "Han text bound to "+id.Name+": "+strconv.Quote(lit.value))
						}
					}
				}
			}
			return true
		})
	}
	return violations
}

// collectHanIdents 收集包内声明值含汉字的 const/var 名字（含函数内的 := 与 var）。
func collectHanIdents(file *ast.File) map[string]bool {
	out := map[string]bool{}
	ast.Inspect(file, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.ValueSpec:
			for i, id := range node.Names {
				if i >= len(node.Values) {
					continue
				}
				for _, lit := range stringLiterals(node.Values[i]) {
					if containsHan(lit.value) {
						out[id.Name] = true
					}
				}
			}
		case *ast.AssignStmt:
			for i, lhs := range node.Lhs {
				id, ok := lhs.(*ast.Ident)
				if !ok || i >= len(node.Rhs) {
					continue
				}
				for _, lit := range stringLiterals(node.Rhs[i]) {
					if containsHan(lit.value) {
						out[id.Name] = true
					}
				}
			}
		}
		return true
	})
	return out
}

func calleeName(expr ast.Expr) string {
	switch fn := expr.(type) {
	case *ast.Ident:
		return fn.Name
	case *ast.SelectorExpr:
		if pkg, ok := fn.X.(*ast.Ident); ok {
			return pkg.Name + "." + fn.Sel.Name
		}
		return fn.Sel.Name
	}
	return ""
}

// keyName 同时认结构体字段名（Ident）与 map 字面量的字符串键（BasicLit）。
func keyName(expr ast.Expr) string {
	switch key := expr.(type) {
	case *ast.Ident:
		return key.Name
	case *ast.BasicLit:
		if key.Kind == token.STRING {
			if v, err := strconv.Unquote(key.Value); err == nil {
				return v
			}
		}
	}
	return ""
}

type stringLiteral struct {
	node  ast.Node
	value string
}

// stringLiterals 展开表达式里直接可见的字符串字面量（含 a + b 拼接与 fmt.Sprintf 的格式串）。
func stringLiterals(expr ast.Expr) []stringLiteral {
	var out []stringLiteral
	ast.Inspect(expr, func(n ast.Node) bool {
		lit, ok := n.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		value, err := strconv.Unquote(lit.Value)
		if err != nil {
			value = lit.Value
		}
		out = append(out, stringLiteral{node: lit, value: value})
		return true
	})
	return out
}

// identifiers 取表达式里出现的标识符（用于判定"汉字常量被传进 emitter"）。
func identifiers(expr ast.Expr) []*ast.Ident {
	var out []*ast.Ident
	ast.Inspect(expr, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			ast.Inspect(sel.X, func(m ast.Node) bool {
				if id, ok := m.(*ast.Ident); ok {
					out = append(out, id)
				}
				return true
			})
			return false
		}
		if id, ok := n.(*ast.Ident); ok {
			out = append(out, id)
		}
		return true
	})
	return out
}
