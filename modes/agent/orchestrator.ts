import{isCancel,text} from "@clack/prompts";
import chalk from "chalk";

export async function runAgentMode(){
    console.log(chalk.bold('\n Agent Mode \n'));

    const goal = await text({
        message:"What would you like the agent to do?",
        placeholder:"Concrete task for this codebase..."
    });

    if(isCancel(goal) || !goal.trim()) return;
}