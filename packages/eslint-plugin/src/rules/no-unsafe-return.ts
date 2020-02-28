import * as util from '../util';
import {
  TSESTree,
  AST_NODE_TYPES,
} from '@typescript-eslint/experimental-utils';

export default util.createRule({
  name: 'no-unsafe-return',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallows returning any from a function',
      category: 'Possible Errors',
      recommended: false,
      requiresTypeChecking: true,
    },
    messages: {
      unsafeReturn: 'Unsafe return of an {{type}} typed value',
      unsafeReturnAssignment:
        'Unsafe return of type {{sender}} from function with return type {{receiver}}',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const { program, esTreeNodeToTSNodeMap } = util.getParserServices(context);
    const checker = program.getTypeChecker();

    function getParentFunctionNode(
      node: TSESTree.Node,
    ):
      | TSESTree.ArrowFunctionExpression
      | TSESTree.FunctionDeclaration
      | TSESTree.FunctionExpression
      | null {
      let current = node.parent;
      while (current) {
        if (
          current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
          current.type === AST_NODE_TYPES.FunctionDeclaration ||
          current.type === AST_NODE_TYPES.FunctionExpression
        ) {
          return current;
        }

        current = current.parent;
      }

      return null;
    }

    function checkReturn(
      returnNode: TSESTree.Node,
      reportingNode: TSESTree.Node = returnNode,
    ): void {
      const tsNode = esTreeNodeToTSNodeMap.get(returnNode);
      const anyType = util.isAnyOrAnyArrayTypeDiscriminated(tsNode, checker);
      if (anyType !== util.AnyType.Safe) {
        return context.report({
          node: reportingNode,
          messageId: 'unsafeReturn',
          data: {
            type: anyType === util.AnyType.Any ? 'any' : 'any[]',
          },
        });
      }

      const functionNode = getParentFunctionNode(returnNode);
      if (!functionNode?.returnType) {
        return;
      }

      // function has an explicit return type, so ensure it's a safe return
      const returnNodeType = checker.getTypeAtLocation(
        esTreeNodeToTSNodeMap.get(returnNode),
      );
      const functionType = checker.getTypeAtLocation(
        esTreeNodeToTSNodeMap.get(functionNode),
      );

      for (const signature of functionType.getCallSignatures()) {
        const functionReturnType = signature.getReturnType();
        if (returnNodeType === functionReturnType) {
          // don't bother checking if they're the same
          // either the function is explicitly declared to return the same type
          // or there was no declaration, so the return type is implicit
          return;
        }

        const result = util.isUnsafeAssignment(
          returnNodeType,
          functionReturnType,
          checker,
        );
        if (!result) {
          return;
        }

        const { sender, receiver } = result;
        return context.report({
          node: reportingNode,
          messageId: 'unsafeReturnAssignment',
          data: {
            sender: checker.typeToString(sender),
            receiver: checker.typeToString(receiver),
          },
        });
      }
    }

    return {
      ReturnStatement(node): void {
        const argument = node.argument;
        if (!argument) {
          return;
        }

        checkReturn(argument, node);
      },
      'ArrowFunctionExpression > :not(BlockStatement).body': checkReturn,
    };
  },
});
